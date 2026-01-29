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

bun run check                     # Full check: knip + lint + tests
```

**Always run `bun run check` before committing.**

---

## Runtime: Bun Only

Do not use Node.js, npm, yarn, or pnpm. Use Bun APIs exclusively.

| Use | Instead of |
|-----|------------|
| `Bun.file()` / `Bun.write()` | `fs.readFile()` / `fs.writeFile()` |
| `Bun.spawn()` / `Bun.spawnSync()` | `child_process.spawn()` |
| `Bun.which()` | `which` package |
| `import.meta.main` | `require.main === module` |
| Bun auto-loads `.env` | `dotenv` package |

---

## Code Style

## Error Handling

```typescript
// User-facing messages: use @clack/prompts
import * as p from "@clack/prompts";
p.log.error("Config not found");
p.log.warn("No uncommitted changes");
p.log.success("Review complete!");
p.log.info("Starting review...");

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
import { describe, expect, test } from "bun:test";
import { parseArgs } from "@/cli";

describe("parseArgs", () => {
  test("parses command correctly", () => {
    const result = parseArgs(["init"]);
    expect(result.command).toBe("init");
  });

  test("handles --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.showHelp).toBe(true);
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
├── commands/           # CLI subcommands (init, run, stop, status, logs)
└── lib/                # Core logic
    ├── types.ts        # Type definitions (AgentType, Config, etc.)
    ├── config.ts       # Config file management
    ├── agents.ts       # Agent execution logic
    ├── engine.ts       # Review cycle orchestration
    ├── tmux.ts         # Tmux session management
    ├── logger.ts       # Log file handling
    └── html.ts         # HTML log viewer generation

tests/                  # Mirror of src/ structure
├── cli.test.ts
├── commands/
└── lib/
```

---

## Prohibited

| Pattern | Why |
|---------|-----|
| `as any`, `@ts-ignore`, `@ts-expect-error` | Defeats type safety |
| Empty catch blocks `catch {}` | Swallows errors silently |
| `require()` for application code | Use ES module imports |
| Node.js `fs`, `child_process` | Use Bun APIs |
| `npm` / `yarn` / `pnpm` | Bun only |
| Relative imports with `../` | Use `@/` path alias |
