# Repository Guidelines

## Project Structure & Module Organization

This is a Bun-only TypeScript CLI project. Entry points live in `src/cli.ts` and
`src/cli-rrr.ts`, with command implementations in `src/commands/`. Core behavior is under
`src/lib/`, including agent runners, config loading, git helpers, logging, review workflow, and
tmux integration. Terminal UI code uses OpenTUI/React in `src/lib/tui/`. Tests mirror source areas
under `tests/`, with helpers in `tests/helpers/` and `tests/test-utils/`. Static assets and type
declarations are in `assets/` and `assets.d.ts`; maintenance scripts are in `scripts/`.

## Build, Test, and Development Commands

- `bun install`: install dependencies from `bun.lock`.
- `bun src/cli.ts --help`: run the CLI directly during development.
- `bun run rr -- <command>`: run the package script wrapper for CLI commands.
- `bun test`: run the full Bun test suite.
- `bun test tests/commands/run.test.ts`: run one test file.
- `bun run check`: required pre-submit verification; runs typecheck, knip, Biome lint, and coverage
  tests.

Use Bun for all runtime and script work. Do not use `npm`, `yarn`, `pnpm`, Node `fs`, or
`child_process` APIs in application code.

## Coding Style & Naming Conventions

Biome enforces 2-space indentation, 100-character lines, double quotes, ES5 trailing commas, and
organized imports. Use `@/` path aliases for imports from `src/`; avoid relative parent imports.
Use `camelCase` for functions and variables, `PascalCase` for types and interfaces,
`UPPER_SNAKE_CASE` for module constants, and kebab-case filenames such as `session-detail-scroll.ts`.
Prefer type-only imports where appropriate. Do not use `as any`, `@ts-ignore`, or empty catch blocks.

## Testing Guidelines

Tests use `bun:test`. Place tests in `tests/<area>/` with names ending in `.test.ts` or `.test.tsx`.
Use sentence-style test names, for example `"returns undefined when --help is passed"`. Add or update
tests before changing behavior, and cover real logic rather than mocked behavior. Keep test output
clean; expected errors should be captured and asserted.

## Commit & Pull Request Guidelines

Recent history uses conventional commit prefixes such as `feat(...)`, `fix(...)`, `refactor(...)`,
and `chore:`. Keep commits scoped and descriptive, for example
`fix(tui): hide iteration progress bar during fixer agent phase`. Do not commit without explicit
approval. Pull requests should describe the user-visible change, list verification performed
(`bun run check`), link related issues, and include screenshots or terminal output when UI behavior
changes.
