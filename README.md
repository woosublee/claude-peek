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

### 1. `~/.claude/settings.json` 에 marketplace 등록

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

> `~/.claude/settings.json` 이 없으면 새로 만들면 됩니다.
> 이미 다른 내용이 있다면 기존 내용에 `extraKnownMarketplaces` 항목만 추가하세요.

### 2. Claude Code에서 설치 및 설정

```
/plugin install claude-peek
/claude-peek:setup
```

## Requirements

- Node.js 18+
