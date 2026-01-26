/**
 * Logs command - view review logs in browser
 */

import { platform } from "node:os";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { getCommandDef } from "@/cli";
import { parseCommand } from "@/lib/cli-parser";
import { getHtmlPath, writeLogHtml } from "@/lib/html";
import { getLatestLogSession, listLogSessions } from "@/lib/logger";

/**
 * Options for logs command
 */
interface LogsOptions {
  list: boolean;
}

/**
 * Open a file in the default browser
 */
async function openInBrowser(filePath: string): Promise<void> {
  const os = platform();

  try {
    if (os === "darwin") {
      await $`open ${filePath}`.quiet();
    } else if (os === "linux") {
      await $`xdg-open ${filePath}`.quiet();
    } else if (os === "win32") {
      await $`start ${filePath}`.quiet();
    } else {
      p.log.info(`Open this file in your browser: ${filePath}`);
    }
  } catch {
    p.log.info(`Open this file in your browser: ${filePath}`);
  }
}

/**
 * Format timestamp for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Main logs command handler
 */
export async function runLogs(args: string[]): Promise<void> {
  // Parse options
  const logsDef = getCommandDef("logs");
  if (!logsDef) {
    p.log.error("Internal error: logs command definition not found");
    process.exit(1);
  }

  let options: LogsOptions;
  let positional: string[];
  try {
    const result = parseCommand<LogsOptions>(logsDef, args);
    options = result.values;
    positional = result.positional;
  } catch (error) {
    p.log.error(`${error}`);
    process.exit(1);
  }

  // Handle --list flag
  if (options.list) {
    const sessions = await listLogSessions();

    if (sessions.length === 0) {
      p.log.info("No logs found.");
      p.log.message('Start a review with "rr run" first.');
      return;
    }

    p.intro("Log Sessions");

    for (const session of sessions) {
      p.log.step(session.name);
      p.log.message(`  Modified: ${formatDate(session.timestamp)}`);
      p.log.message(`  Path: ${session.path}`);
    }
    return;
  }

  // Handle specific timestamp argument from positional args
  const timestampArg = positional[0];

  if (timestampArg) {
    // Find session matching the timestamp
    const sessions = await listLogSessions();
    const session = sessions.find((s) => s.name.includes(timestampArg));

    if (!session) {
      p.log.error(`Log session not found: ${timestampArg}`);
      p.log.message('Use "rr logs --list" to see available sessions.');
      process.exit(1);
    }

    // Generate HTML and open
    const s = p.spinner();
    s.start("Generating HTML...");
    await writeLogHtml(session.path);
    s.stop("Done");

    const htmlPath = getHtmlPath(session.path);
    p.log.success(`Opening log: ${session.name}`);
    await openInBrowser(htmlPath);
    return;
  }

  // Default: open most recent log
  const latestSession = await getLatestLogSession();

  if (!latestSession) {
    p.log.info("No logs found.");
    p.log.message('Start a review with "rr run" first.');
    return;
  }

  // Generate HTML and open
  const s = p.spinner();
  s.start("Generating HTML...");
  await writeLogHtml(latestSession.path);
  s.stop("Done");

  const htmlPath = getHtmlPath(latestSession.path);
  p.log.success(`Opening latest log: ${latestSession.name}`);
  await openInBrowser(htmlPath);
}
