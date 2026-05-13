import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const statuslinePath = join(repoRoot, 'statusline.mjs');
const displayCwd = join(tmpdir(), 'claude-peek');

async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'claude-peek-test-'));
  await mkdir(join(home, '.claude', 'plugins', 'claude-peek'), { recursive: true });
  return home;
}

async function removeHome(home) {
  await rm(home, { recursive: true, force: true });
}

async function runStatusline(stdin, { home, env = {}, timeoutMs = 5000 } = {}) {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_BASE_URL;
  delete childEnv.ANTHROPIC_API_BASE_URL;

  const child = spawn(process.execPath, [statuslinePath], {
    cwd: repoRoot,
    env: {
      ...childEnv,
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: '1',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.end(JSON.stringify(stdin));

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const exitCode = await new Promise(resolveExit => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stderr += `statusline timed out after ${timeoutMs}ms\n`;
      child.kill('SIGKILL');
      resolveExit(null);
    }, timeoutMs);

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr += `${error.message}\n`;
      resolveExit(null);
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  return { exitCode, stdout, stderr };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), 'utf8');
}

function baseStdin(overrides = {}) {
  return {
    model: { display_name: 'Claude Sonnet 4.6', id: 'claude-sonnet-4-6' },
    cwd: displayCwd,
    context_window: {
      used_percentage: 42,
      current_usage: {
        input_tokens: 420,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      context_window_size: 1000,
    },
    ...overrides,
  };
}

test('renders claude-peek compact statusline data without upstream layout changes', async () => {
  const home = await makeHome();
  try {
    const cachePath = join(home, '.claude', 'plugins', 'claude-peek', '.usage-cache.json');
    await writeJson(cachePath, {
      timestamp: Date.now(),
      data: {
        planName: 'Pro',
        fiveHour: 34,
        sevenDay: 63,
        fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sevenDayResetAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const result = await runStatusline(baseStdin(), { home });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Claude Sonnet 4\.6 \| Pro/);
    assert.match(result.stdout, /claude-peek/);
    assert.match(result.stdout, /Context/);
    assert.match(result.stdout, /Usage/);
    assert.match(result.stdout, /34%/);
    assert.match(result.stdout, /63%/);
    assert.doesNotMatch(result.stdout, /claude-hud/);
  } finally {
    await removeHome(home);
  }
});

test('falls back to token calculation when native context percentage is zero', async () => {
  const home = await makeHome();
  try {
    const result = await runStatusline(baseStdin({
      context_window: {
        used_percentage: 0,
        current_usage: {
          input_tokens: 250,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 0,
        },
        context_window_size: 1000,
      },
    }), { home });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Context/);
    assert.match(result.stdout, /30%/);
    assert.doesNotMatch(result.stdout, /Context[^\n]* 0%/);
  } finally {
    await removeHome(home);
  }
});

test('uses Claude Code stdin rate_limits before external usage fetching', async () => {
  const home = await makeHome();
  try {
    const result = await runStatusline(baseStdin({
      rate_limits: {
        five_hour: {
          used_percentage: 12.4,
          resets_at: Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000),
        },
        seven_day: {
          used_percentage: 56.7,
          resets_at: Math.floor((Date.now() + 4 * 24 * 60 * 60 * 1000) / 1000),
        },
      },
    }), { home, env: { ANTHROPIC_BASE_URL: 'https://example.invalid' } });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage/);
    assert.match(result.stdout, /12%/);
    assert.match(result.stdout, /57%/);
  } finally {
    await removeHome(home);
  }
});

test('recovers from corrupt usage lock and keeps rendering stale usage cache', async () => {
  const home = await makeHome();
  try {
    const pluginDir = join(home, '.claude', 'plugins', 'claude-peek');
    const cachePath = join(pluginDir, '.usage-cache.json');
    const lockPath = join(pluginDir, '.usage-cache.lock');

    await writeJson(cachePath, {
      timestamp: Date.now() - 10 * 60 * 1000,
      data: {
        planName: 'Max',
        fiveHour: 44,
        sevenDay: 88,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
      },
    });
    await writeFile(lockPath, '{not-json', 'utf8');

    const result = await runStatusline(baseStdin(), { home });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Claude Sonnet 4\.6 \| Max/);
    assert.match(result.stdout, /44%/);
    assert.match(result.stdout, /88%/);
    assert.equal(existsSync(lockPath), false);
  } finally {
    await removeHome(home);
  }
});

test('tracks duplicate todo contents without collapsing task ids', async () => {
  const home = await makeHome();
  try {
    const transcriptPath = join(home, 'transcript.jsonl');
    const entries = [
      {
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'todo-write-1',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Same task', status: 'pending' },
                { content: 'Same task', status: 'pending' },
              ],
            },
          }],
        },
      },
      {
        timestamp: new Date(Date.now() - 50_000).toISOString(),
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-create-1',
            name: 'TaskCreate',
            input: { taskId: '1', subject: 'Same task', status: 'pending' },
          }],
        },
      },
      {
        timestamp: new Date(Date.now() - 40_000).toISOString(),
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-create-2',
            name: 'TaskCreate',
            input: { taskId: '2', subject: 'Same task', status: 'pending' },
          }],
        },
      },
      {
        timestamp: new Date(Date.now() - 30_000).toISOString(),
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'todo-write-2',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Same task', status: 'pending' },
                { content: 'Same task', status: 'pending' },
              ],
            },
          }],
        },
      },
      {
        timestamp: new Date(Date.now() - 20_000).toISOString(),
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'task-update-2',
            name: 'TaskUpdate',
            input: { taskId: '2', status: 'in_progress' },
          }],
        },
      },
    ];
    await writeFile(transcriptPath, entries.map(entry => JSON.stringify(entry)).join('\n'), 'utf8');

    const result = await runStatusline(baseStdin({ transcript_path: transcriptPath }), { home });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /▸ Same task \(0\/2\)/);
  } finally {
    await removeHome(home);
  }
});
