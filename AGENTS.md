# AGENTS.md

Style and development guidelines for AI agents working in this repository.

## Commands

```bash
bun install                       # Install dependencies
bun src/cli.ts --help             # Run CLI during development

bun test                          # Run all tests
bun test tests/cli.test.ts        # Run single test file
bun test --grep "parseArgs"       # Run tests matching pattern

bun run lint                      # Lint and auto-format with Biome
bun run ci                        # Lint check only (no auto-fix)
bun run knip                      # Dead code detection
bun run check                     # Full check: knip + lint + tests
```

**Always run `bun run check` before committing.**

---

## Runtime: Bun Only

Do not use Node.js, npm, yarn, or pnpm.

| Use | Instead of |
|-----|------------|
| `Bun.file()` / `Bun.write()` | `fs.readFile()` / `fs.writeFile()` |
| `Bun.spawn()` / `Bun.spawnSync()` | `child_process.spawn()` |
| `Bun.which()` | `which` package |
| `bun:test` | `jest` / `vitest` |
| Bun auto-loads `.env` | `dotenv` package |

---

## Code Style

### Formatting (Biome)

- 2-space indent, 100 char line width
- Double quotes, semicolons required
- ES5 trailing commas (arrays/objects, not function params)

### Imports

```typescript
// 1. External packages first
import * as p from "@clack/prompts";
import type { SpawnOptions } from "bun";

// 2. Internal modules with @/* path alias (not relative ../)
import { runEngine } from "@/lib/engine";
import type { Config } from "@/lib/types";  // explicit 'import type' required
```

### Types

```typescript
// Type aliases for unions, interfaces for data structures
export type AgentType = "codex" | "claude" | "opencode";
export interface Config { reviewer: AgentSettings; }

// Const arrays for runtime validation
export const VALID_AGENT_TYPES = ["codex", "claude", "opencode"] as const;

// Type guards with 'is' prefix
export function isAgentType(value: unknown): value is AgentType { ... }
```

**Strict mode**: `noUncheckedIndexedAccess` requires explicit undefined checks.

### Naming

| Element | Convention | Example |
|---------|------------|---------|
| Functions/Variables | camelCase | `parseArgs`, `configPath` |
| Types/Interfaces | PascalCase | `AgentType`, `ParsedArgs` |
| Constants | SCREAMING_SNAKE | `VALID_AGENT_TYPES` |
| Type guards | `is` prefix | `isAgentType()` |
| Files | kebab-case | `run-foreground.ts` |

---

## Error Handling

```typescript
// User-facing: use @clack/prompts
import * as p from "@clack/prompts";
p.log.error("Config not found");
p.log.warn("No uncommitted changes");
p.log.success("Review complete!");

// Internal: try-catch with exit
try {
  await runEngine(config);
} catch (error) {
  console.error("Engine failed:", error);
  process.exit(1);
}
```

---

## Testing

```typescript
import { describe, expect, test } from "bun:test";
import { parseArgs } from "@/cli";

describe("parseArgs", () => {
  test("returns undefined when --help is passed", () => {
    expect(parseArgs(["--help"])).toBeUndefined();
  });
});
```

- Test files: `tests/<module>.test.ts`
- Sentence-style names: `"returns undefined when --help is passed"`
- Nest with `describe` for logical grouping

---

## Project Structure

```
src/
├── cli.ts              # Entry point, argument parsing
├── commands/           # CLI subcommands (1:1 mapping)
└── lib/                # Core logic (agents, engine, types, config)

tests/                  # Test files named <module>.test.ts
```

---

## Prohibited

| Pattern | Why |
|---------|-----|
| `as any`, `@ts-ignore` | Defeats type safety |
| Empty catch blocks | Swallows errors |
| `require()` | Use ES modules |
| Node.js `fs` module | Use Bun APIs |
| `npm` / `yarn` / `pnpm` | Bun only |
