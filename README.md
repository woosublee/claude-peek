# claude-peek

A clean, compact statusline for Claude Code — context, usage, git, and todos at a glance.

```
[claude-sonnet-4-6 | Pro] │ my-project git:(main*) │ Context ████░░░░░░ 42%
Usage ███░░░░░░░ 34% (1h 42m / 5h) │ ██████░░░░ 63% (2d 23h / 7d)
⏱ 12m │ abstract-booping-sifakis │ 8 MCPs │ ◐ running agent name
```

## Features

- **Line 1**: Model, plan type, project name, git branch, context usage bar
- **Line 2**: 5h session usage + 7d weekly usage with reset timers
- **Line 3**: Session duration, session name, MCP/hook/todo counts, running agents (`◐`)
- **Graceful truncation**: Never drops a line — truncates with `…` on narrow terminals

## Requirements

- Node.js 18+
- Claude Code (latest)

## Install

#### 1. Add claude-peek as a known marketplace

Add the following to `~/.claude/settings.json` (create the file if it doesn't exist):

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

If the file already has other settings, add only the `extraKnownMarketplaces` key alongside them.

#### 2. Install the plugin inside Claude Code

```
/plugin install claude-peek
```

This downloads the plugin from GitHub.

#### 3. Configure the statusline

```
/claude-peek:setup
```

This detects the install path and automatically updates `statusLine` in `settings.json`.

The statusline will appear on your next message.

## Uninstall

Remove the `statusLine` key from `~/.claude/settings.json`, or replace it with another statusline command.

## Credits

Based on [claude-hud](https://github.com/jarrodwatts/claude-hud) by [@jarrodwatts](https://github.com/jarrodwatts).
