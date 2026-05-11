export type SpinnerFactory = () => {
  start: (message: string) => void;
  stop: (message: string) => void;
};

export const CONSOLE_LOG = console.log.bind(console) as (message: string) => void;
export const CONSOLE_ERROR = console.error.bind(console) as (message: string) => void;
export const PROCESS_EXIT = process.exit.bind(process) as (code: number) => void;
