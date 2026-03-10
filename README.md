# claude-peek

A clean, compact statusline for Claude Code.

```
[claude-sonnet-4-6 | Pro] │ my-project git:(main*) │ Context ████░░ 42%
Usage ███░░░░░░░ 34% (1h 42m / 5h) | ██████░░░░ 63% (2d 23h / 7d)
⏱ 12m │ abstract-booping-sifakis │ 8 MCPs
```

## Features

- **Line 1**: Model, plan, project, git branch, context bar
- **Line 2**: 5h session usage + 7d weekly usage with reset timers
- **Line 3**: Session duration, session name, config counts, agents, todos
- **Graceful truncation**: Never drops a line — truncates with `…` when terminal is narrow

## Install

```
/plugin install claude-peek
/claude-peek:setup
```

## Requirements

- Node.js 18+
