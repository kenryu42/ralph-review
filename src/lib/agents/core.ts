export type StreamFormatter = (line: string) => string | null;

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

export function defaultBuildEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
  };
}

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

export function stripSystemReminders(text: unknown): string {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  return normalized.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

export function isAgentAvailable(command: string): boolean {
  return Bun.which(command) !== null;
}

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
      lineBuffer += text;
      const lines = lineBuffer.split("\n");

      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const formatted = formatter(line);
        if (formatted !== null && formatted !== "") {
          writeStream.write(`${formatted}\n\n`);
        } else if (formatted === null) {
          writeStream.write(`${line}\n`);
        }
      }
    } else {
      writeStream.write(text);
    }
  }

  const remaining = decoder.decode();
  if (remaining) {
    output += remaining;
  }

  if (usesJsonl && formatter) {
    if (remaining) {
      lineBuffer += remaining;
    }
    if (lineBuffer.trim()) {
      const formatted = formatter(lineBuffer);
      if (formatted !== null && formatted !== "") {
        writeStream.write(`${formatted}\n\n`);
      } else if (formatted === null) {
        writeStream.write(`${lineBuffer}\n`);
      }
    }
  } else if (remaining) {
    writeStream.write(remaining);
  }

  return output;
}
