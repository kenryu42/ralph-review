/**
 * Logs command - view review logs in browser
 */

import { platform } from "node:os";
import * as p from "@clack/prompts";
import { $ } from "bun";
import { getHtmlPath, writeLogHtml } from "@/lib/html";
import { getLatestLogSession, listLogSessions } from "@/lib/logger";

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
  // Handle --list flag
  if (args.includes("--list") || args.includes("-l")) {
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

  // Handle specific timestamp argument
  const timestampArg = args.find((a) => !a.startsWith("-"));

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
