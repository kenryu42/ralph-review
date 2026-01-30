/**
 * Core shared utilities for agent execution
 * Provides streaming, availability checks, and common formatting
 */

/**
 * Formatter function type for JSONL line formatting
 */
export type StreamFormatter = (line: string) => string | null;

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
