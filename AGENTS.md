# AGENTS.md

Style and development guidelines for AI agents working in this repository.

## Commands

```bash
bun install                       # Install dependencies
bun src/cli.ts --help             # Run CLI during development

bun test                          # Run all tests
bun test tests/cli.test.ts        # Run single test file
bun test tests/lib/config.test.ts # Run nested test file
bun test --grep "parseArgs"       # Run tests matching pattern

bun run check                     # Full check: typecheck + knip + lint + tests
```

**Always use `bun run check` to verify changes.** This runs typecheck, knip, biome lint, and tests together. Do not run these separately.

---

## Runtime: Bun Only

Do not use Node.js, npm, yarn, or pnpm. Use Bun APIs exclusively.

| Use | Instead of |
|-----|------------|
| `Bun.file()` / `Bun.write()` | `fs.readFile()` / `fs.writeFile()` |
| `Bun.spawn()` / `Bun.spawnSync()` | `child_process.spawn()` |
| `Bun.which()` | `which` package |
| `import.meta.main` | `require.main === module` |
| `$` from `bun` (shell) | `child_process.exec()` |
| Bun auto-loads `.env` | `dotenv` package |

---

## Code Style

### Formatting (enforced by Biome)

- **Indent**: 2 spaces
- **Line width**: 100 characters max
- **Quotes**: Double quotes for strings
- **Trailing commas**: ES5 style (in objects, arrays)
- **Imports**: Automatically organized by Biome

### Imports

```typescript
// Path alias - always use @/ for src imports
import { loadConfig } from "@/lib/config";
import type { Config, AgentSettings } from "@/lib/types";

// Type-only imports use `import type`
import type { AgentRole } from "@/lib/types/domain";
```

### Naming Conventions

- **Functions/variables**: `camelCase` - `parseConfig`, `loadConfig`, `sessionExists`
- **Types/interfaces**: `PascalCase` - `AgentType`, `Config`, `ReviewSummary`
- **Constants**: `UPPER_SNAKE_CASE` for module-level - `CONFIG_PATH`, `VALID_AGENT_TYPES`
- **Type guards**: `is` prefix - `isAgentType()`, `isReasoningLevel()`, `isRecord()`
- **Files**: `kebab-case.ts` - `cli-parser.ts`, `session-panel-utils.ts`

### Type Patterns

```typescript
// Union types for domain values
export type AgentType = "codex" | "claude" | "opencode" | "droid" | "gemini" | "pi";
export type Priority = "P0" | "P1" | "P2" | "P3";

// Type guards for runtime validation
const VALID_AGENT_TYPES: readonly AgentType[] = ["codex", "claude", ...];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && VALID_AGENT_TYPES.includes(value as AgentType);
}
```

### Error Handling

```typescript
// User-facing messages: use @clack/prompts
import * as p from "@clack/prompts";
p.log.error("Config not found");
p.log.warn("No uncommitted changes");
p.log.success("Review complete!");

// Internal errors: try-catch with exit
try {
  await runEngine(config);
} catch (error) {
  p.log.error(`Error: ${error}`);
  process.exit(1);
}
```

---

## Testing

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseArgs } from "@/cli";

describe("parseArgs", () => {
  test("parses command correctly", () => {
    const result = parseArgs(["init"]);
    expect(result.command).toBe("init");
  });
});
```

- Test files: `tests/<module>.test.ts` or `tests/<dir>/<module>.test.ts`
- Sentence-style names: `"returns undefined when --help is passed"`
- Nest with `describe` for logical grouping
- The `AGENT=1` env var is set during `bun run check` for LLM friendly output

---

## Project Structure

```
src/
├── cli.ts              # Entry point, argument parsing
├── cli-core.ts         # CLI utilities (version, help, commands)
├── cli-rrr.ts          # Quick run alias entry point
├── commands/           # CLI subcommands (init, run, stop, status, log, list, dashboard)
└── lib/                # Core logic
    ├── types/          # Type definitions (Config, AgentType, etc.)
    ├── agents/         # Agent implementations (claude, codex, etc.)
    ├── prompts/        # Prompt templates (reviewer, fixer)
    ├── html/           # HTML log viewer generation
    ├── tui/            # Terminal UI components
    ├── config.ts       # Config file management
    ├── engine.ts       # Review cycle orchestration
    ├── tmux.ts         # Tmux session management
    └── logger.ts       # Log file handling

tests/                  # Mirrors src/ structure
├── cli.test.ts
├── commands/
└── lib/
```

## Prohibited

| Pattern | Why |
|---------|-----|
| `as any`, `@ts-ignore`, `@ts-expect-error` | Defeats type safety |
| Empty catch blocks `catch {}` | Swallows errors silently |
| `require()` for application code | Use ES module imports |
| Node.js `fs`, `child_process` | Use Bun APIs |
| `npm` / `yarn` / `pnpm` | Bun only |
| Relative imports with `../` | Use `@/` path alias |
| Configuring `knip.json` to bypass warnings/errors | Fix the root cause |
| Non-Bun test runner | Use `bun:test` only |
