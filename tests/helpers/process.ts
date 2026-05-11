type SpawnProcess = ReturnType<typeof Bun.spawn>;

export function createTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

export function createErroringStream(delayMs: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.error(new Error("stream failure"));
      }, delayMs);
    },
  });
}

export function createMockProcess(
  stdout: ReadableStream<Uint8Array> | null,
  stderr: ReadableStream<Uint8Array> | null,
  exited: Promise<number> | number,
  onKill?: () => void
): SpawnProcess {
  return {
    stdout,
    stderr,
    exited: typeof exited === "number" ? Promise.resolve(exited) : exited,
    kill: () => {
      onKill?.();
      return true;
    },
  } as unknown as SpawnProcess;
}

export function useImmediateTimeout(): () => void {
  const originalSetTimeout: typeof setTimeout = globalThis.setTimeout;
  const immediateSetTimeout = ((
    ...args: Parameters<typeof setTimeout>
  ): ReturnType<typeof setTimeout> => {
    const handler = args[0];
    if (typeof handler === "function") {
      handler();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.setTimeout = immediateSetTimeout;
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}
