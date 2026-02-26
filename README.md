# Ralph Review

[![CI](https://github.com/kenryu42/ralph-review/actions/workflows/ci.yml/badge.svg)](https://github.com/kenryu42/ralph-review/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/kenryu42/ralph-review/branch/main/graph/badge.svg?token=C9QTION6ZF)](https://codecov.io/github/kenryu42/ralph-review)
[![Version](https://img.shields.io/github/v/tag/kenryu42/ralph-review?label=version&color=blue)](https://github.com/kenryu42/ralph-review)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)

Run review-fix cycles until your code is clean.

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [How It Works](#how-it-works)
- [Agent Roles](#agent-roles)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Supported Coding Agents](#supported-coding-agents)
- [Configuration](#configuration)
- [License](#license)

---

## Why This Exists

I've been a huge fan of Codex's review feature ever since its [first release](https://x.com/DanielEdrisian/status/1968819243694104899). Because the GPT Codex model actually reads many files to gather context and reasoning, it is slower than other agents, but it consistently finds bugs they miss.

My usual workflow was repetitive: run a Codex review, copy and paste the findings into a new session,
ask another agent if it agrees, and then ask it to fix the issues.

Why not fix it in the same session? Because I wanted an independent second opinion before applying changes, and a fresh context helped avoid the first agent’s bias carrying into the fix.

Doing that manually is tedious and time-consuming, so I built this tool to automate the loop. Inspired by the [Ralph Wiggum technique](https://ghuntley.com/ralph/) by Geoffrey Huntley. I also
wanted an easy way to try different coding agents and models.

I also occasionally run a code simplifier pass before review, so I included that workflow here too.

If this helps other people, great. If not, it still helps me.

---

## How It Works

Ralph Review automates code review by pairing two AI agents -- a **reviewer** and a **fixer** -- and looping until the code is clean or the iteration limit is reached.

```text
┌──────────────────────────────┐
│         Your changes         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Code Simplifier (optional)   │
└──────────────┬───────────────┘
               │
               ▼
      ┌─────────────────┐
      │ Reviewer agent  │ ◀───────────────────────────────────────┐
      └────────┬────────┘                                         │
               │                                                  │
               ▼                                                  │
   ┌───────────────────────┐                                      │
   │ Create git checkpoint │                                      │
   └───────────┬───────────┘                                      │
               │                                                  │
               ▼                                                  │
      ┌─────────────────┐                                         │
      │   Fixer agent   │                                         │
      │  (verify & fix) │                                         │
      └────────┬────────┘                                         │
               │                                                  │
               ▼                                                  │
    ┌───────────────────────┐                                     │
    │   Parse fix summary   │                                     │
    └──────────┬────────────┘                                     │
               │                                                  │
               ├── no issues found (verified by fixer) ──▶ Stop   │
               ├── issues found, all skipped by fixer  ──▶ Stop   │
               │                                                  │
               ▼                                                  │
  Discard checkpoint, loop back to Reviewer ──────────────────────┘
  (until max iterations reached)
```

**How the cycle works:**

1. An optional **code simplifier** pass can run first (enabled with `--simplifier`) to reduce code complexity before review.
2. The **reviewer** analyzes your changes and returns structured review output.
3. A **git checkpoint** is created so the fixer's changes can be rolled back if something goes wrong.
4. The **fixer** independently reads the code, confirms each issue is real, and applies fixes only where warranted. It does not blindly trust the reviewer.
5. The fixer outputs a structured summary. If it reports no actionable issues left -- either no real issues were found or all remaining items were safely skipped -- the cycle ends.
6. Otherwise, the cycle repeats from step 2 until no issues remain or the configured iteration limit is hit.

You can assign different AI agents to each role (e.g. Claude reviews, Gemini fixes).

---

## Agent Roles

Ralph Review orchestrates three distinct roles. You can assign any [supported coding agent](#supported-coding-agents) to each role.

### Code Simplifier (optional)

Enabled with `--simplifier`. Runs once before the review loop begins, reducing code complexity while preserving exact behavior. Operates on the same diff scope as the reviewer (uncommitted changes, base branch diff, or a specific commit).

Prompt adapted from the [Claude Code code-simplifier plugin](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md).

### Reviewer

Analyzes changes for bugs that impact correctness, security, reliability, or maintainability. Outputs structured JSON with findings, each tagged P0–P3 by priority. Ignores style nits and pre-existing issues — only flags bugs introduced in the change. Does not suggest fixes.

Prompt adapted from the [Codex CLI review prompt](https://github.com/openai/codex/blob/main/codex-rs/core/review_prompt.md).

### Fixer

Treats review findings as untrusted input — verifies every claim against actual code before acting. Classifies each issue as APPLY (real and fixable) or SKIP (false positive or not actionable). Applies minimal safe changes, then runs project verification (lint, typecheck, tests, build). When no actionable issues remain, signals the cycle to stop.

---

## Prerequisites

- [Bun](https://bun.sh) (runtime)
- [tmux](https://github.com/tmux/tmux) (background sessions)
- At least one [supported agent CLI](#supported-coding-agents) installed and authenticated

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

# Or use shorthand alias for `rr run`
rrr
```

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

# Edit configuration in your editor
rr config edit

# Or set a specific config using cli
rr config set maxIterations 5
```

Run `rr doctor` to verify that your environment and configuration are valid. Add `--fix` to let it auto-resolve common issues.

---

## License

MIT
