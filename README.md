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

Run the following three commands inside Claude Code:

```
/plugin marketplace add woosublee/claude-peek
/plugin install claude-peek
/claude-peek:setup
```

The statusline will appear on your next message.

## Uninstall

Remove the `statusLine` key from `~/.claude/settings.json`, or replace it with another statusline command.

## Credits

Based on [claude-hud](https://github.com/jarrodwatts/claude-hud) by [@jarrodwatts](https://github.com/jarrodwatts).
