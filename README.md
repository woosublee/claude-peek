# claude-peek

A clean, compact statusline for Claude Code — context, usage, git, and todos at a glance.

```
[claude-sonnet-4-6 | Pro] │ my-project git:(main*) │ Context ████░░░░░░ 42%
Usage ███░░░░░░░ 34% (1h 42m / 5h) │ ██████░░░░ 63% (2d 23h / 7d)
⏱ 12m │ abstract-booping-sifakis │ 8 MCPs
```

## Features

- **Line 1**: Model, plan type, project name, git branch, context usage bar
- **Line 2**: 5h session usage + 7d weekly usage with reset timers
- **Line 3**: Session duration, session name, MCP/hook/todo counts
- **Graceful truncation**: Never drops a line — truncates with `…` on narrow terminals

## Requirements

- Node.js 18+
- Claude Code (latest)

## Install

### Option A — Plugin (recommended)

#### 1. Register as a marketplace in `~/.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "claude-peek": {
      "source": {
        "source": "github",
        "repo": "woosublee/claude-peek"
      }
    }
  }
}
```

> If `~/.claude/settings.json` doesn't exist, create it. If it already has content, add only the `extraKnownMarketplaces` key alongside existing keys.

#### 2. Install and configure inside Claude Code

```
/plugin install claude-peek
/claude-peek:setup
```

`/claude-peek:setup` will automatically find the installed plugin path and update `statusLine` in `settings.json`.

---

### Option B — Manual (local clone)

#### 1. Clone the repo

```bash
git clone https://github.com/woosublee/claude-peek.git ~/Documents/dev/claude-peek
```

#### 2. Update `~/.claude/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'NODE=$(command -v node || echo /usr/local/bin/node); \"$NODE\" \"$HOME/Documents/dev/claude-peek/statusline.mjs\"'"
  }
}
```

Adjust the path to match wherever you cloned the repo.

---

The statusline will appear on your next message after either setup method.

## Troubleshooting

**Linux: cross-device link error during install**

If you see a cross-device link error, set `TMPDIR` before launching Claude Code:

```bash
TMPDIR=~/.cache/tmp claude
```

This happens because `/tmp` often uses a separate filesystem on Linux.

**Usage bar not showing**

The usage bar requires a Claude Pro/Max/Team subscription and fetches data from Anthropic's OAuth API. API credentials are read from macOS Keychain or `~/.claude/.credentials.json`. If the bar doesn't appear after a few messages, check that you're logged in to Claude Code.

## Uninstall

Remove the `statusLine` key from `~/.claude/settings.json`, or replace it with another statusline command.

## Credits

Based on [claude-hud](https://github.com/jarrodwatts/claude-hud) by [@jarrodwatts](https://github.com/jarrodwatts).
