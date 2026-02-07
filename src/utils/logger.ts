const PREFIX = "[agentbox]";

export function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
