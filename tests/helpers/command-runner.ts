import type { CommandRunner } from "../../scripts/generate-changelog";

type RunnerResponse = string | Error;

export function createMockRunner(responses: readonly [string, RunnerResponse][]): CommandRunner {
  return (strings: TemplateStringsArray, ...values: readonly string[]) => {
    const command = strings.reduce((accumulator, part, index) => {
      const value = values[index] ?? "";
      return `${accumulator}${part}${value}`;
    }, "");

    return {
      text: async () => {
        const match = responses.find(([pattern]) => command.includes(pattern));
        if (!match) {
          throw new Error(`Unexpected command: ${command}`);
        }

        const response = match[1];
        if (response instanceof Error) {
          throw response;
        }

        return response;
      },
    };
  };
}
