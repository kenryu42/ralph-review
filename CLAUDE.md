# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun test tests/cli.test.ts        # Run single test file
bun test --grep "parseArgs"       # Run tests matching pattern
bun run check        # Full check: typecheck + knip + lint + tests (AGENT=1)
bun run typecheck    # TypeScript type checking only
bun run lint         # Lint and auto-format with Biome
bun run ci           # Lint check only (no auto-fix)
bun run knip         # Dead code detection
bun src/cli.ts --help             # Run CLI during development
bun run dev:tui                   # Run TUI dev mode (scripts/tui-dev.tsx)
```

## Runtime

This project uses **Bun exclusively**. Do not use Node.js, npm, yarn, or pnpm.

- Use `Bun.file()` / `Bun.write()` instead of fs module
- Use `Bun.spawn()` for subprocesses
- Use `bun:test` for testing
- Bun auto-loads `.env` (no dotenv needed)

## Architecture

ralph-review is a CLI that automates code review cycles using AI agents (Claude, Codex, Droid, Gemini, OpenCode, Pi).

### Core Flow

1. **Review Phase**: Reviewer agent analyzes changes (uncommitted, branch diff, or specific commit)
2. **Implementation Phase**: If issues found, fixer agent applies fixes
3. **Repeat**: Continue until no issues or max iterations reached

### CLI Entry Points

| Entry point | Purpose |
|-------------|---------|
| `src/cli.ts` | Main CLI entry point (`rr` / `ralph-review`) — dispatches to commands |
| `src/cli-core.ts` | Command definitions, argument parsing, help text generation |
| `src/cli-rrr.ts` | Quick alias (`rrr`) — passes args directly to `rr run` |

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/lib/engine.ts` | Review cycle orchestration (the main loop with retry logic) |
| `src/lib/agents/` | Agent system — registry, runner, per-agent configs and stream parsers |
| `src/lib/prompts/` | Prompt generation for reviewer, fixer, and code-simplifier roles |
| `src/lib/lockfile.ts` | Session locking — prevents concurrent reviews per project |
| `src/lib/tmux.ts` | Background execution via tmux sessions |
| `src/lib/config.ts` | Configuration storage (~/.config/ralph-review/) |
| `src/lib/logger.ts` | Log file management |
| `src/lib/html/` | HTML generation for log viewer and dashboard |
| `src/lib/server.ts` | Dashboard HTTP server with session management |
| `src/lib/tui/` | Terminal UI components (OpenTUI + React) |
| `src/terminal/` | Theme and color palette for terminal output |

### Agent System

Six agents are defined in `src/lib/agents/registry.ts`, each with:
- `config`: Contains `command`, `buildArgs()`, `buildEnv()` — how to invoke the agent CLI
- `usesJsonl`: Whether output is JSONL (streamed) or plain text
- `formatLine()`: Formats JSONL stream lines for display
- `extractResult()`: Extracts the final result text from agent output

Per-agent modules (`claude.ts`, `codex.ts`, `droid.ts`, `gemini.ts`, `opencode.ts`, `pi.ts`) define these per agent. Stream event types live in `agents/types.ts`.

The runner (`agents/runner.ts`) spawns agent processes via `Bun.spawn()` and streams stdout/stderr through `core.ts`.

### Commands

Commands in `src/commands/` map 1:1 to CLI subcommands:
- `init.ts` — Configure reviewer/fixer agents interactively
- `run.ts` — Start review cycle (spawns tmux, then `_run-foreground`)
- `list.ts` — List active review sessions (`rr list` / `rr ls`)
- `status.ts`, `stop.ts` — Session management
- `logs.ts` — View review logs (terminal or JSON)
- `dashboard.ts` — Open HTML dashboard in browser

## Code Style

See `AGENTS.md` for detailed style guidelines. Key points:

- **Biome** for formatting: 2-space indent, double quotes, 100 char width
- **Path aliases**: Use `@/*` for `./src/*` (never relative `../` imports)
- **Type imports**: Use explicit `import type { ... }`
- Tests live in `tests/` directory, mirroring `src/` structure

## Before Committing

Run `bun run check` to ensure all checks pass.

**Always use `bun run check` to verify changes.** Do not run `bun run lint`, `bun test`, or `bun run knip` separately — use `bun run check` which runs all of them together.

**Never commit changes unless explicitly asked.** Wait for explicit instructions like "commit this" or "make a commit" before running any git commit commands.
