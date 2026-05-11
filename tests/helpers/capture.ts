export const EXIT_PREFIX = "__FORCED_EXIT__:";

export function createPromptLogCapture(selectValues: unknown[] = []) {
  const values = [...selectValues];
  const infos: string[] = [];
  const errors: string[] = [];
  const steps: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];
  const selectMessages: string[] = [];

  return {
    infos,
    errors,
    steps,
    messages,
    successes,
    selectMessages,
    module: {
      log: {
        info: (message: string) => {
          infos.push(message);
        },
        error: (message: string) => {
          errors.push(message);
        },
        step: (message: string) => {
          steps.push(message);
        },
        message: (message: string) => {
          messages.push(message);
        },
        success: (message: string) => {
          successes.push(message);
        },
      },
      select: async (input: { message: string }) => {
        selectMessages.push(input.message);
        return values.shift();
      },
      isCancel: (value: unknown) => value === "__CANCEL__",
    },
  };
}

export function createSpinnerCapture() {
  const starts: string[] = [];
  const stops: string[] = [];

  return {
    starts,
    stops,
    spinner: () => ({
      start: (message: string) => starts.push(message),
      stop: (message: string) => stops.push(message),
    }),
  };
}

export async function withStdoutTTY<T>(isTTY: boolean, run: () => Promise<T>): Promise<T> {
  const originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: isTTY,
  });

  try {
    return await run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }
}

export async function withMutedTerminalLogs<T>(run: () => Promise<T>): Promise<T> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    return await run();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

export async function captureJsonOutput(run: () => Promise<void>): Promise<unknown[]> {
  const outputs: unknown[] = [];
  const originalConsoleLog = console.log;
  console.log = ((...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === "string") {
      outputs.push(JSON.parse(args[0]));
      return;
    }
    outputs.push(args);
  }) as typeof console.log;

  try {
    await run();
  } finally {
    console.log = originalConsoleLog;
  }

  return outputs;
}

export async function captureExitCode(run: () => Promise<void>): Promise<number | undefined> {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
  }) as typeof process.exit;

  try {
    await run();
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(EXIT_PREFIX)) {
      return Number.parseInt(error.message.slice(EXIT_PREFIX.length), 10);
    }
    throw error;
  } finally {
    process.exit = originalExit;
  }
}
