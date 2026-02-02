/**
 * Core shared utilities for agent execution
 * Provides streaming, availability checks, and common formatting
 */

/**
 * Formatter function type for JSONL line formatting
 */
export type StreamFormatter = (line: string) => string | null;

/**
 * Parse a single JSONL line into a typed event.
 * Returns null if the line is invalid or not a recognized event type.
 *
 * @param line - The JSONL line to parse
 * @param requiresObjectPrefix - If true, rejects lines not starting with '{'
 */
export function parseJsonlEvent<T>(line: string, requiresObjectPrefix?: boolean): T | null {
  if (!line.trim()) {
    return null;
  }

  if (requiresObjectPrefix && !line.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(line);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== "string") {
      return null;
    }

    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Default buildEnv implementation that passes through process.env
 */
export function defaultBuildEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
  };
}

/**
 * Factory function to create a line formatter for streamAndCapture.
 * Combines a parser and display formatter into a single StreamFormatter.
 *
 * @param parser - Function to parse a JSONL line into an event
 * @param displayFormatter - Function to format an event for display
 */
export function createLineFormatter<T>(
  parser: (line: string) => T | null,
  displayFormatter: (event: T) => string | null
): StreamFormatter {
  return (line: string): string | null => {
    const event = parser(line);
    if (event) {
      return displayFormatter(event) ?? "";
    }
    return null;
  };
}

/**
 * Strip <system-reminder> tags and their content from text.
 */
export function stripSystemReminders(text: unknown): string {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  return normalized.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

/**
 * Check if an agent is available on the system
 */
export function isAgentAvailable(command: string): boolean {
  return Bun.which(command) !== null;
}

/**
 * Stream output to console while capturing it for parsing
 * For JSONL agents, parses and formats for readable display
 * @param stream - The readable stream from process stdout/stderr
 * @param writeStream - Where to write the output (process.stdout or process.stderr)
 * @param usesJsonl - Whether this agent uses JSONL output format
 * @param formatter - Optional formatter function for JSONL lines
 * @returns The accumulated output as a string
 */
export async function streamAndCapture(
  stream: ReadableStream<Uint8Array> | null,
  writeStream: NodeJS.WriteStream,
  usesJsonl: boolean = false,
  formatter?: StreamFormatter
): Promise<string> {
  if (!stream) return "";

  const decoder = new TextDecoder();
  let output = "";
  let lineBuffer = "";

  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    output += text;

    if (usesJsonl && formatter) {
      // Buffer and process complete lines for JSONL
      lineBuffer += text;
      const lines = lineBuffer.split("\n");

      // Keep the last incomplete line in the buffer
      lineBuffer = lines.pop() ?? "";

      // Process complete lines
      for (const line of lines) {
        if (!line.trim()) continue;

        const formatted = formatter(line);
        if (formatted !== null && formatted !== "") {
          writeStream.write(`${formatted}\n\n`);
        } else if (formatted === null) {
          // Preserve non-JSON output (warnings/errors) for observability
          writeStream.write(`${line}\n`);
        }
        // When formatted === "", skip silently (intentionally suppressed event)
      }
    } else {
      writeStream.write(text);
    }
  }

  // Flush any remaining bytes
  const remaining = decoder.decode();
  if (remaining) {
    output += remaining;
  }

  if (usesJsonl && formatter) {
    if (remaining) {
      lineBuffer += remaining;
    }
    // Process any remaining line, even without a trailing newline
    if (lineBuffer.trim()) {
      const formatted = formatter(lineBuffer);
      if (formatted !== null && formatted !== "") {
        writeStream.write(`${formatted}\n\n`);
      } else if (formatted === null) {
        // Preserve non-JSON output (warnings/errors) for observability
        writeStream.write(`${lineBuffer}\n`);
      }
    }
  } else if (remaining) {
    writeStream.write(remaining);
  }

  return output;
}
