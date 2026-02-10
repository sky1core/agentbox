import { spawnSync } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Run a command with inherited stdio (user sees output directly).
 * Returns the exit code.
 */
export function execInherit(cmd: string, args: string[]): number {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  return result.status ?? 1;
}

/**
 * Run a command and capture stdout/stderr.
 */
export function execCapture(cmd: string, args: string[]): ExecResult {
  const result = spawnSync(cmd, args, { encoding: "utf-8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}
