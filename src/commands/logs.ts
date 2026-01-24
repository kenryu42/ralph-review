/**
 * Logs command - view review logs in browser
 */

import { $ } from "bun";
import { platform } from "os";
import { listLogSessions, getLatestLogSession } from "../lib/logger";
import { writeLogHtml, getHtmlPath } from "../lib/html";
import { LOGS_DIR } from "../lib/config";

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
      console.log(`Open this file in your browser: ${filePath}`);
    }
  } catch {
    console.log(`Open this file in your browser: ${filePath}`);
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
      console.log("No logs found.");
      console.log('Start a review with "rr run" first.');
      return;
    }
    
    console.log("📋 Log Sessions\n");
    for (const session of sessions) {
      console.log(`  ${session.name}`);
      console.log(`    Modified: ${formatDate(session.timestamp)}`);
      console.log(`    Path: ${session.path}\n`);
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
      console.error(`Log session not found: ${timestampArg}`);
      console.log('Use "rr logs --list" to see available sessions.');
      process.exit(1);
    }
    
    // Generate HTML and open
    await writeLogHtml(session.path);
    const htmlPath = getHtmlPath(session.path);
    console.log(`Opening log: ${session.name}`);
    await openInBrowser(htmlPath);
    return;
  }
  
  // Default: open most recent log
  const latestSession = await getLatestLogSession();
  
  if (!latestSession) {
    console.log("No logs found.");
    console.log('Start a review with "rr run" first.');
    return;
  }
  
  // Generate HTML and open
  await writeLogHtml(latestSession.path);
  const htmlPath = getHtmlPath(latestSession.path);
  console.log(`Opening latest log: ${latestSession.name}`);
  await openInBrowser(htmlPath);
}
