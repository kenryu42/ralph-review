# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun test tests/cli.test.ts        # Run single test file
bun test --grep "parseArgs"       # Run tests matching pattern
bun run check        # Full check: knip + lint + tests (AGENT=1)
bun run lint         # Lint and auto-format with Biome
bun run ci           # Lint check only (no auto-fix)
bun run knip         # Dead code detection
bun src/cli.ts --help             # Run CLI during development
```

## Runtime

This project uses **Bun exclusively**. Do not use Node.js, npm, yarn, or pnpm.

- Use `Bun.file()` / `Bun.write()` instead of fs module
- Use `Bun.spawn()` for subprocesses
- Use `bun:test` for testing
- Bun auto-loads `.env` (no dotenv needed)

## Architecture

ralph-review is a CLI that automates code review cycles using AI agents (Codex, Claude, OpenCode).

### Core Flow

1. **Review Phase**: Reviewer agent analyzes uncommitted changes
2. **Implementation Phase**: If issues found, fixer agent fixes them
3. **Repeat**: Continue until no issues or max iterations reached

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/cli.ts` | CLI entry point and argument parsing |
| `src/lib/engine.ts` | Review cycle orchestration (the main loop) |
| `src/lib/agents.ts` | Agent registry - defines how to invoke each AI agent |
| `src/lib/tmux.ts` | Background execution via tmux sessions |
| `src/lib/config.ts` | Configuration storage (~/.config/ralph-review/) |
| `src/lib/logger.ts` | Log file management |
| `src/lib/html.ts` | HTML log viewer generation |

### Agent System

Each agent (codex, claude, opencode) is defined in `AGENTS` registry with:
- `command`: The CLI command to run
- `buildArgs()`: Constructs arguments based on role (reviewer/fixer)
- `parseOutput()`: Detects "no issues" patterns to stop the loop

### Commands

Commands in `src/commands/` map 1:1 to CLI subcommands:
- `init.ts` - Configure agents interactively
- `run.ts` - Start review cycle (spawns tmux, then `_run-foreground`)
- `attach.ts`, `status.ts`, `stop.ts` - Session management
- `logs.ts` - Open HTML log viewer

## Code Style

See `AGENTS.md` for detailed style guidelines. Key points:

- **Biome** for formatting: 2-space indent, double quotes, 100 char width
- **Path aliases**: Use `@/*` for `./src/*`
- **Type imports**: Use explicit `import type { ... }`
- Tests live in `tests/` directory, named `<module>.test.ts`

## Before Committing

Run `bun run check` to ensure all checks pass.
