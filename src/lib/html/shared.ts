import { formatDuration } from "@/lib/format";

export { formatDuration };

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const NUMBER_FORMAT = new Intl.NumberFormat();

export function formatDate(timestamp: number): string {
  return DATE_FORMAT.format(new Date(timestamp));
}

export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
