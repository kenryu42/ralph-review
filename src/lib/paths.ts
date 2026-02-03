/**
 * Canonical path to the CLI entry point.
 * Use this instead of Bun.main to ensure consistent behavior regardless of how the CLI was invoked.
 */
export const CLI_PATH = `${import.meta.dir}/../cli.ts`;
