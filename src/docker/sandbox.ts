import { spawn } from "node:child_process";
import { execCapture, execInherit, execWithStdin, type ExecResult } from "../utils/process.js";
import { parseSandboxState, type SandboxState } from "./parser.js";

export function getState(sandboxName: string): SandboxState {
  const result = execCapture("docker", ["sandbox", "ls"]);
  return parseSandboxState(result.stdout, sandboxName);
}

export function listAll(): number {
  return execInherit("docker", ["sandbox", "ls"]);
}

export function create(
  sandboxName: string,
  agent: string,
  workspace: string,
): number {
  return execInherit("docker", [
    "sandbox",
    "create",
    "--name",
    sandboxName,
    agent,
    workspace,
  ]);
}

export function run(sandboxName: string, extraArgs: string[] = []): number {
  return execInherit("docker", [
    "sandbox",
    "run",
    sandboxName,
    ...extraArgs,
  ]);
}

/**
 * Run in background (for restarting a stopped sandbox).
 */
export function runBackground(sandboxName: string): void {
  const child = spawn("docker", ["sandbox", "run", sandboxName], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function envFlags(env?: Record<string, string>): string[] {
  if (!env || Object.keys(env).length === 0) return [];
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

export function execInteractive(
  sandboxName: string,
  workspace: string,
  command: string[],
  env?: Record<string, string>,
): number {
  return execInherit("docker", [
    "sandbox",
    "exec",
    "-it",
    "-w",
    workspace,
    ...envFlags(env),
    sandboxName,
    ...command,
  ]);
}

export function execNonInteractive(
  sandboxName: string,
  workspace: string,
  command: string[],
  env?: Record<string, string>,
): number {
  return execInherit("docker", [
    "sandbox",
    "exec",
    "-w",
    workspace,
    ...envFlags(env),
    sandboxName,
    ...command,
  ]);
}

export function execCaptureInSandbox(
  sandboxName: string,
  workspace: string,
  command: string[],
  env?: Record<string, string>,
): ExecResult {
  return execCapture("docker", [
    "sandbox",
    "exec",
    "-w",
    workspace,
    ...envFlags(env),
    sandboxName,
    ...command,
  ]);
}

export function execWithStdinPipe(
  sandboxName: string,
  shellCommand: string,
  input: Buffer | string,
): void {
  execWithStdin(
    "docker",
    ["sandbox", "exec", "-i", sandboxName, "sh", "-c", shellCommand],
    input,
  );
}

export function stop(sandboxName: string): number {
  return execInherit("docker", ["sandbox", "stop", sandboxName]);
}
