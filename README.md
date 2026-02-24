# Ralph Review

[![CI](https://github.com/kenryu42/ralph-review/actions/workflows/ci.yml/badge.svg)](https://github.com/kenryu42/ralph-review/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/kenryu42/ralph-review/branch/main/graph/badge.svg?token=C9QTION6ZF)](https://codecov.io/github/kenryu42/ralph-review)
[![Version](https://img.shields.io/github/v/tag/kenryu42/ralph-review?label=version&color=blue)](https://github.com/kenryu42/ralph-review)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)

Run review-fix cycles until your code is clean.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Supported Coding Agents](#supported-coding-agents)
- [Configuration](#configuration)
- [License](#license)

---

## How It Works

Ralph Review automates code review by pairing two AI agents -- a **reviewer** and a **fixer** -- and looping until the code is clean or the iteration limit is reached.

```
  Your changes
       |
       v
  (optional) Code Simplifier          
       |                               
       v
  +-----------------+
  | Reviewer agent  |                 
  +-----------------+                 
       |
       v
  Create git checkpoint                
       |
       v
  +-----------------+
  |  Fixer agent    |                 
  | (verify & fix)  |                 
  +-----------------+
       |
       v
  Parse fix summary
       |
       +--- no actionable issues left ---> Stop
       |
       +--- issues remain
       |
       v
  Discard checkpoint, loop back to Reviewer
  (until max iterations reached)
```

**How the cycle works:**

1. An optional **code simplifier** pass can run first (enabled with `--simplifier`) to reduce diff complexity before review.
2. The **reviewer** analyzes your changes and returns structured review output (or raw output fallback).
3. A **git checkpoint** is created so the fixer's changes can be rolled back if something goes wrong.
4. The **fixer** independently reads the code, confirms each issue is real, and applies fixes only where warranted. It does not blindly trust the reviewer.
5. The fixer outputs a structured summary. If it reports no actionable issues left -- either no real issues were found or all remaining items were safely skipped -- the cycle ends.
6. Otherwise, the cycle repeats from step 2 until no issues remain or the configured iteration limit is hit.

You can assign different AI agents to each role (e.g. Claude reviews, Gemini fixes).

---

## Prerequisites

- [Bun](https://bun.sh) (runtime)
- [tmux](https://github.com/tmux/tmux) (background sessions)
- At least one supported agent CLI installed and authenticated

---

## Installation

```bash
npm install -g ralph-review
```

---

## Quick Start

```bash
# Auto-detect installed agents and configure reviewer/fixer
rr init

# Start a review cycle (runs in tmux)
rr run
```

`rr run` launches a tmux session so you can detach and keep working. Use `rr status` to check progress and `rr stop` to cancel.

---

## Commands

| Command | Description |
|---------|-------------|
| `rr init` | Configure reviewer, fixer, and simplifier agents (auto-detects installed CLIs) |
| `rr run` | Start review cycle in a tmux session |
| `rr run --base main` | Review changes against a base branch |
| `rr run --uncommitted` | Review staged, unstaged, and untracked changes |
| `rr run --commit SHA` | Review changes introduced by a specific commit |
| `rr run --max N` | Set max iterations |
| `rr run --simplifier` | Run a code-simplifier pass before review iterations |
| `rr config show` | Print full configuration |
| `rr config set KEY VAL` | Update a config value (e.g. `rr config set maxIterations 8`) |
| `rr list` | List active review sessions |
| `rr status` | Show current review status |
| `rr stop` | Stop running review session (`--all` to stop all) |
| `rr log` | View review logs (`-n 5` for last 5, `--json` for JSON output) |
| `rr dashboard` | Open review dashboard in browser |
| `rr doctor` | Run environment and configuration diagnostics (`--fix` to auto-resolve) |

The `rrr` command is a shorthand alias for `rr run` -- all flags work the same.

---

## Supported Coding Agents

| Agent | Link |
|-------|------|
| Claude Code | https://code.claude.com/docs/en/overview |
| Codex | https://openai.com/codex/ |
| Droid | https://factory.ai/ |
| Gemini CLI | https://geminicli.com/ |
| OpenCode | https://opencode.ai/ |
| Pi | https://pi.dev |

---

## Configuration

After running `rr init`, Ralph Review stores its configuration in your project directory. You can view and modify settings with the `rr config` subcommand:

```bash
# View current configuration
rr config show

# Change a setting
rr config set maxIterations 5
```

Run `rr doctor` to verify that your environment and configuration are valid. Add `--fix` to let it auto-resolve common issues.

---

## License

MIT
