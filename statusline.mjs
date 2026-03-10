#!/usr/bin/env node
// ~/.claude/statusline.mjs — Custom Claude Code statusline
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { execSync, execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import { request } from 'https';
import { homedir } from 'os';
import { join, dirname } from 'path';

// ── ANSI ─────────────────────────────────────────────────────────────────────
const R  = '\x1b[0m';
const DIM = '\x1b[2m';
const cyan    = s => `\x1b[36m${s}${R}`;
const yellow  = s => `\x1b[33m${s}${R}`;
const magenta = s => `\x1b[35m${s}${R}`;
const dim     = s => `${DIM}${s}${R}`;
const green   = s => `\x1b[32m${s}${R}`;
const red     = s => `\x1b[31m${s}${R}`;
const SEP     = `${DIM} │ ${R}`;

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function vlen(s) { return [...stripAnsi(s)].length; }

function truncate(line, maxWidth) {
  if (vlen(line) <= maxWidth) return line;
  // ANSI 코드를 보존하면서 가시 문자 기준으로 자름
  const ANSI_RE = /^\x1b\[[0-9;]*m/;
  let result = '';
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < maxWidth - 1) {
    const m = ANSI_RE.exec(line.slice(i));
    if (m) { result += m[0]; i += m[0].length; continue; }
    result += line[i]; visible++; i++;
  }
  return result + R + '…';
}

function ctxColor(pct) {
  if (pct >= 85) return '\x1b[31m';
  if (pct >= 70) return '\x1b[33m';
  return '\x1b[32m';
}
function quotaColor(pct) {
  if (pct >= 90) return '\x1b[31m';  // 빨강
  if (pct >= 75) return '\x1b[95m';  // 밝은 자홍
  return '\x1b[94m';                 // 밝은 파랑
}
function coloredBar(pct, colorFn = ctxColor) {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
  return `${colorFn(pct)}${'█'.repeat(filled)}${DIM}${'░'.repeat(10 - filled)}${R}`;
}

// ── stdin ─────────────────────────────────────────────────────────────────────
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { return JSON.parse(chunks.join('')); } catch { return null; }
}

// ── git ───────────────────────────────────────────────────────────────────────
function getGit(cwd) {
  if (!cwd) return null;
  try {
    const branch = execSync('git branch --show-current', {
      cwd, timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!branch) return null;
    const dirty = execSync('git status --porcelain', {
      cwd, timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().length > 0;
    return { branch, dirty };
  } catch { return null; }
}

// ── transcript ────────────────────────────────────────────────────────────────
async function parseTranscript(path) {
  const result = { sessionName: null, sessionStart: null, agents: [], todos: [] };
  if (!path || !existsSync(path)) return result;
  const agentMap = new Map();
  const taskIdToIndex = new Map();
  let latestTodos = [];
  let latestSlug = null, customTitle = null;
  try {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (!result.sessionStart && e.timestamp) result.sessionStart = new Date(e.timestamp);
        if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
        if (typeof e.slug === 'string') latestSlug = e.slug;
        const blocks = e.message?.content;
        if (!Array.isArray(blocks)) continue;
        for (const b of blocks) {
          if (b.type === 'tool_use' && b.id) {
            if (b.name === 'Task' || b.name === 'Agent') {
              agentMap.set(b.id, { type: b.input?.subagent_type ?? 'agent', description: b.input?.description, status: 'running' });
            } else if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
              latestTodos = [...b.input.todos];
              taskIdToIndex.clear();
            } else if (b.name === 'TaskCreate') {
              const subject = b.input?.subject ?? b.input?.description ?? 'Untitled task';
              const status = normalizeTaskStatus(b.input?.status) ?? 'pending';
              latestTodos.push({ content: subject, status });
              const taskId = b.input?.taskId != null ? String(b.input.taskId) : b.id;
              if (taskId) taskIdToIndex.set(taskId, latestTodos.length - 1);
            } else if (b.name === 'TaskUpdate') {
              const taskId = b.input?.taskId != null ? String(b.input.taskId) : null;
              let idx = taskId != null ? taskIdToIndex.get(taskId) : null;
              if (idx == null && taskId != null && /^\d+$/.test(taskId)) {
                const n = parseInt(taskId, 10) - 1;
                if (n >= 0 && n < latestTodos.length) idx = n;
              }
              if (idx != null) {
                const status = normalizeTaskStatus(b.input?.status);
                if (status) latestTodos[idx].status = status;
                const content = b.input?.subject ?? b.input?.description;
                if (content) latestTodos[idx].content = content;
              }
            }
          }
          if (b.type === 'tool_result' && b.tool_use_id && agentMap.has(b.tool_use_id)) {
            const text = (Array.isArray(b.content) ? b.content : [])
              .filter(c => c.type === 'text').map(c => c.text).join('');
            if (text.includes('Async agent launched successfully')) {
              // output_file 경로 추출 후 완료 여부 확인
              const m = text.match(/output_file:\s*(\S+)/);
              const outputFile = m ? m[1] : null;
              let done = false;
              if (outputFile && existsSync(outputFile)) {
                try {
                  const lines = readFileSync(outputFile, 'utf-8').trim().split('\n');
                  for (let i = lines.length - 1; i >= 0; i--) {
                    try {
                      const last = JSON.parse(lines[i]);
                      if (last.type === 'assistant' && last.message?.stop_reason === 'end_turn') { done = true; break; }
                      if (last.type === 'assistant') break;
                    } catch {}
                  }
                } catch {}
              }
              agentMap.get(b.tool_use_id).status = done ? 'completed' : 'running';
            } else {
              agentMap.get(b.tool_use_id).status = 'completed';
            }
          }
        }
      } catch {}
    }
  } catch {}
  result.sessionName = customTitle ?? latestSlug;
  result.agents = [...agentMap.values()];
  result.todos = latestTodos;
  return result;
}

function normalizeTaskStatus(status) {
  switch (status) {
    case 'pending': case 'not_started': return 'pending';
    case 'in_progress': case 'running': return 'in_progress';
    case 'completed': case 'complete': case 'done': return 'completed';
    default: return null;
  }
}

// ── config counts ─────────────────────────────────────────────────────────────
function getConfigCounts(cwd) {
  const home = homedir();
  const claudeDir = join(home, '.claude');
  let claudeMdCount = 0, rulesCount = 0, mcpCount = 0, hooksCount = 0;
  try {
    const us = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));
    mcpCount += Object.keys(us.mcpServers ?? {}).length;
    hooksCount += Object.keys(us.hooks ?? {}).length;
    if (existsSync(join(claudeDir, 'CLAUDE.md'))) claudeMdCount++;
  } catch {}
  try {
    const rulesDir = join(claudeDir, 'rules');
    if (existsSync(rulesDir))
      rulesCount += readdirSync(rulesDir).filter(f => f.endsWith('.md')).length;
  } catch {}
  if (cwd) {
    try { if (existsSync(join(cwd, 'CLAUDE.md'))) claudeMdCount++; } catch {}
    try { if (existsSync(join(cwd, 'CLAUDE.local.md'))) claudeMdCount++; } catch {}
    try {
      const ps = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf-8'));
      mcpCount += Object.keys(ps.mcpServers ?? {}).length;
    } catch {}
    try {
      const mcp = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf-8'));
      mcpCount += Object.keys(mcp.mcpServers ?? {}).length;
    } catch {}
  }
  return { claudeMdCount, rulesCount, mcpCount, hooksCount };
}

// ── duration ──────────────────────────────────────────────────────────────────
function formatDuration(start) {
  if (!start) return null;
  const mins = Math.floor((Date.now() - start.getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatResetTime(resetAt) {
  if (!resetAt) return '';
  const diffMs = new Date(resetAt).getTime() - Date.now();
  if (diffMs <= 0) return '';
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60), mins = diffMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24), remH = hours % 24;
    return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ── usage API ─────────────────────────────────────────────────────────────────
const home = homedir();
const PLUGIN_DIR  = join(home, '.claude', 'plugins', 'claude-peek');
const CACHE_PATH  = join(PLUGIN_DIR, '.usage-cache.json');
const LOCK_PATH   = join(PLUGIN_DIR, '.usage-cache.lock');
const BACKOFF_PATH = join(PLUGIN_DIR, '.keychain-backoff');
const FAILURE_TTL    = 15_000;
const KEYCHAIN_SVC   = 'Claude Code-credentials';

function getPlanName(sub) {
  if (!sub) return null;
  const l = sub.toLowerCase();
  if (l.includes('max'))  return 'Max';
  if (l.includes('pro'))  return 'Pro';
  if (l.includes('team')) return 'Team';
  if (l.includes('api'))  return null;
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

function readUsageCache() {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    const ttl = c.data?.apiUnavailable ? FAILURE_TTL : Infinity;
    if (Date.now() - c.timestamp > ttl) return null;
    return c.data;
  } catch { return null; }
}

function writeUsageCache(data) {
  try {
    if (!existsSync(PLUGIN_DIR)) mkdirSync(PLUGIN_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ data, timestamp: Date.now() }), 'utf-8');
  } catch {}
}

function getCredentials() {
  const now = Date.now();
  // Keychain backoff
  try {
    if (existsSync(BACKOFF_PATH)) {
      const ts = parseInt(readFileSync(BACKOFF_PATH, 'utf-8'), 10);
      if (now - ts < 60_000) return null;
    }
  } catch {}

  // macOS Keychain
  try {
    const raw = execFileSync('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SVC, '-w'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    }).trim();
    if (raw) {
      const data = JSON.parse(raw);
      const tok = data.claudeAiOauth?.accessToken;
      const sub = data.claudeAiOauth?.subscriptionType ?? '';
      const exp = data.claudeAiOauth?.expiresAt;
      if (tok && !(exp != null && exp <= now)) return { accessToken: tok, subscriptionType: sub };
    }
  } catch (e) {
    const msg = String(e?.message ?? '') + String(e?.stderr ?? '');
    if (!msg.toLowerCase().includes('could not be found')) {
      try { writeFileSync(BACKOFF_PATH, String(now), 'utf-8'); } catch {}
    }
  }

  // File fallback
  try {
    const cred = JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf-8'));
    const tok = cred.claudeAiOauth?.accessToken;
    const sub = cred.claudeAiOauth?.subscriptionType ?? '';
    const exp = cred.claudeAiOauth?.expiresAt;
    if (tok && !(exp != null && exp <= now)) return { accessToken: tok, subscriptionType: sub };
  } catch {}

  return null;
}

function fetchUsageApi(accessToken) {
  return new Promise(resolve => {
    const req = request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1',
      },
      timeout: 8000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getUsage() {
  // Custom API endpoint → skip
  const base = process.env.ANTHROPIC_BASE_URL?.trim() || process.env.ANTHROPIC_API_BASE_URL?.trim();
  if (base) {
    try { if (new URL(base).origin !== 'https://api.anthropic.com') return null; } catch { return null; }
  }

  const cached = readUsageCache();

  // 캐시 여부와 관계없이 항상 백그라운드 fetch 트리거
  // (lock으로 중복 방지, Claude 응답 시간 동안 완료되어 다음 메시지엔 최신 데이터 표시)
  try {
    if (!existsSync(PLUGIN_DIR)) mkdirSync(PLUGIN_DIR, { recursive: true });
    if (existsSync(LOCK_PATH)) {
      try {
        const lockAge = Date.now() - parseInt(readFileSync(LOCK_PATH, 'utf-8'), 10);
        if (lockAge > 10_000) unlinkSync(LOCK_PATH);
        else { return cached ?? null; }
      } catch { return cached ?? null; }
    }
    const child = spawn(process.execPath, [process.argv[1], '--bg-fetch'], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, _CLAUDE_PEEK_BG: '1' },
    });
    child.unref();
  } catch {}
  return cached ?? null;
}

async function bgFetch() {
  // Lock (stale lock 자동 제거)
  let hasLock = false;
  try {
    if (!existsSync(PLUGIN_DIR)) mkdirSync(PLUGIN_DIR, { recursive: true });
    try {
      const lockAge = Date.now() - parseInt(readFileSync(LOCK_PATH, 'utf-8'), 10);
      if (lockAge > 10_000) unlinkSync(LOCK_PATH);
    } catch {}
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, String(Date.now()), 'utf-8');
    closeSync(fd);
    hasLock = true;
  } catch {
    return;
  }

  try {
    const creds = getCredentials();
    if (!creds) return null;

    const planName = getPlanName(creds.subscriptionType);
    if (!planName) return null;

    const apiData = await fetchUsageApi(creds.accessToken);
    if (!apiData) {
      const fail = { planName, fiveHour: null, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null, apiUnavailable: true };
      writeUsageCache(fail);
      return fail;
    }

    const clamp = v => (v == null || !isFinite(v)) ? null : Math.round(Math.max(0, Math.min(100, v)));
    const result = {
      planName,
      fiveHour:       clamp(apiData.five_hour?.utilization),
      sevenDay:       clamp(apiData.seven_day?.utilization),
      fiveHourResetAt:  apiData.five_hour?.resets_at ?? null,
      sevenDayResetAt:  apiData.seven_day?.resets_at ?? null,
    };
    writeUsageCache(result);
    return result;
  } finally {
    if (hasLock) try { unlinkSync(LOCK_PATH); } catch {}
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
if (process.argv.includes('--bg-fetch')) {
  bgFetch().catch(() => {}).then(() => process.exit(0));
} else {
  main().catch(() => {});
}

async function main() {
  const stdin = await readStdin();
  if (!stdin) return;

  const width = process.stdout.columns || 80;

  // 컨텍스트 %
  const pct = Math.min(100, Math.max(0, Math.round(
    stdin.context_window?.used_percentage ?? (() => {
      const u = stdin.context_window?.current_usage;
      const sz = stdin.context_window?.context_window_size;
      if (!sz) return 0;
      return ((u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)) / sz * 100;
    })()
  )));

  // 모델 + 플랜
  const model = stdin.model?.display_name?.trim() ?? stdin.model?.id ?? 'Unknown';

  // 프로젝트 + git
  const cwd = stdin.cwd;
  const projectName = cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() : null;
  const git = getGit(cwd);

  // transcript + usage (병렬)
  const [tr, usage] = await Promise.all([
    parseTranscript(stdin.transcript_path),
    getUsage(),
  ]);

  // config counts
  const { claudeMdCount, rulesCount, mcpCount, hooksCount } = getConfigCounts(cwd);

  // ── 줄 1: [model | Plan] │ project git:(branch*) │ Context bar% ───────────
  const planDisplay = usage?.planName ? `${model} | ${usage.planName}` : model;
  const modelPart = cyan(`[${planDisplay}]`);

  let projectPart = '';
  if (projectName) {
    projectPart = yellow(projectName);
    if (git) projectPart += ` ${magenta('git:(')}${cyan(git.branch + (git.dirty ? '*' : ''))}${magenta(')')}`;
  }

  const ctxPart = `${dim('Context')} ${coloredBar(pct)} ${ctxColor(pct)}${pct}%${R}`;

  let usagePart = '';
  if (usage && !usage.apiUnavailable && usage.fiveHour != null) {
    const fiveHourColor = `${quotaColor(usage.fiveHour)}${usage.fiveHour}%${R}`;
    const fiveHourReset = formatResetTime(usage.fiveHourResetAt);
    const fiveHourBar = coloredBar(usage.fiveHour, quotaColor);
    const fiveHourStr = fiveHourReset
      ? `${fiveHourBar} ${fiveHourColor} (${fiveHourReset} / 5h)`
      : `${fiveHourBar} ${fiveHourColor}`;

    if (usage.sevenDay != null) {
      const sevenDayColor = `${quotaColor(usage.sevenDay)}${usage.sevenDay}%${R}`;
      const sevenDayReset = formatResetTime(usage.sevenDayResetAt);
      const sevenDayBar = coloredBar(usage.sevenDay, quotaColor);
      const sevenDayStr = sevenDayReset
        ? `${sevenDayBar} ${sevenDayColor} (${sevenDayReset} / 7d)`
        : `${sevenDayBar} ${sevenDayColor}`;
      usagePart = `${dim('Usage')} ${fiveHourStr} | ${sevenDayStr}`;
    } else {
      usagePart = `${dim('Usage')} ${fiveHourStr}`;
    }
  } else if (usage?.apiUnavailable) {
    usagePart = `${dim('Usage')} ${yellow('⚠')}`;
  }

  const line1 = [modelPart, projectPart, ctxPart].filter(Boolean).join(SEP);
  console.log(R + truncate(line1, width));

  // ── 줄 2: Usage bar ───────────────────────────────────────────────────────
  if (usagePart) console.log(R + truncate(usagePart, width));

  // ── 줄 3: ⏱ dur │ session-name │ CLAUDE.md │ MCPs ───────────────────────
  const line3Parts = [];
  const dur = formatDuration(tr.sessionStart);
  if (dur) line3Parts.push(dim(`⏱ ${dur}`));
  if (tr.sessionName) line3Parts.push(dim(tr.sessionName));
  if (claudeMdCount > 0) line3Parts.push(dim(`${claudeMdCount} CLAUDE.md`));
  if (rulesCount > 0)    line3Parts.push(dim(`${rulesCount} rules`));
  if (mcpCount > 0)      line3Parts.push(dim(`${mcpCount} MCPs`));
  if (hooksCount > 0)    line3Parts.push(dim(`${hooksCount} hooks`));

  // 실행 중인 에이전트
  for (const a of tr.agents.filter(a => a.status === 'running').slice(0, 2)) {
    const desc = a.description ? a.description.slice(0, 25) + (a.description.length > 25 ? '…' : '') : a.type;
    line3Parts.push(`◐ ${dim(desc)}`);
  }

  // 투두
  if (tr.todos.length > 0) {
    const done = tr.todos.filter(t => t.status === 'completed').length;
    const total = tr.todos.length;
    const cur = tr.todos.find(t => t.status === 'in_progress');
    const label = cur ? cur.content.slice(0, 20) + (cur.content.length > 20 ? '…' : '') : '';
    line3Parts.push(dim(label ? `▸ ${label} (${done}/${total})` : `▸ ${done}/${total} done`));
  }

  if (line3Parts.length > 0) {
    console.log(R + truncate(line3Parts.join(SEP), width));
  }
}
