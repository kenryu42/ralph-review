import { join } from "node:path";
import { generateDashboardHtml as generateDashboardPageHtml } from "@/lib/html/dashboard/page";
import { generateLogHtml as generateLogPageHtml } from "@/lib/html/log/page";
import { getHtmlPath, readLog } from "@/lib/logger";
import type { DashboardData, LogEntry } from "@/lib/types";

export { getHtmlPath } from "@/lib/logger";

export function getDashboardPath(logsDir: string): string {
  return join(logsDir, "dashboard.html");
}

export function generateLogHtml(entries: LogEntry[]): string {
  return generateLogPageHtml(entries);
}

export async function writeLogHtml(logPath: string): Promise<void> {
  const entries = await readLog(logPath);
  const html = generateLogHtml(entries);
  await Bun.write(getHtmlPath(logPath), html);
}

export function generateDashboardHtml(data: DashboardData): string {
  return generateDashboardPageHtml(data);
}

export async function writeDashboardHtml(
  dashboardPath: string,
  data: DashboardData
): Promise<void> {
  const html = generateDashboardHtml(data);
  await Bun.write(dashboardPath, html);
}
