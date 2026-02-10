import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import * as lima from "../runtime/lima.js";
import { log } from "../utils/logger.js";

export type BootstrapPhase = "onCreate" | "onStart";

function isWorkspaceScriptPath(p: string): boolean {
  // Treat relative paths as workspace scripts. (Includes "./foo.sh" and "scripts/foo.sh")
  return !p.startsWith("~/") && !isAbsolute(p);
}

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/**
 * Ensure a script exists inside the VM and return the VM path.
 *
 * - Workspace script: returned path is under the workspace (mounted at same path).
 * - Host script (~ or absolute): copied into VM home directory.
 */
function prepareScriptInVm(
  vmName: string,
  workspace: string,
  scriptPath: string,
): { vmPath: string; display: string } {
  // Absolute paths inside the workspace should be executed as-is.
  if (isAbsolute(scriptPath) && scriptPath.startsWith(workspace)) {
    if (!existsSync(scriptPath)) {
      throw new Error(`[agentbox] bootstrap script not found: ${scriptPath}`);
    }
    return { vmPath: scriptPath, display: scriptPath };
  }

  if (isWorkspaceScriptPath(scriptPath)) {
    const hostPath = resolve(workspace, scriptPath);
    if (!existsSync(hostPath)) {
      throw new Error(`[agentbox] bootstrap script not found: ${scriptPath} (resolved: ${hostPath})`);
    }
    // Workspace is mounted at the same absolute path inside the VM.
    return { vmPath: hostPath, display: scriptPath };
  }

  // Host path that needs injection via limactl copy.
  const hostPath = expandHome(scriptPath);
  if (!existsSync(hostPath)) {
    throw new Error(`[agentbox] bootstrap script not found: ${scriptPath} (resolved: ${hostPath})`);
  }

  // Determine target path inside VM
  // ~ is mounted read-only, so copy to a writable location
  const base = basename(hostPath) || "bootstrap.sh";
  const vmPath = `/tmp/agentbox-bootstrap/${base}.${sha1(hostPath).slice(0, 8)}.sh`;

  // Copy file from host to VM
  lima.shellNonInteractive(vmName, "/tmp", [
    "mkdir", "-p", "/tmp/agentbox-bootstrap",
  ]);
  lima.copyToVm(vmName, hostPath, vmPath);

  return { vmPath, display: scriptPath };
}

export function runBootstrap(
  phase: BootstrapPhase,
  vmName: string,
  workspace: string,
  scripts: string[],
  env: Record<string, string>,
): void {
  if (scripts.length === 0) return;

  for (const scriptPath of scripts) {
    const { vmPath, display } = prepareScriptInVm(
      vmName,
      workspace,
      scriptPath,
    );
    log(`bootstrap ${phase}: ${display}`);

    // Run via interpreter so exec bit is not required.
    const code = lima.shellNonInteractive(
      vmName,
      workspace,
      ["bash", "-euo", "pipefail", vmPath],
      env,
    );
    if (code !== 0) {
      throw new Error(`[agentbox] bootstrap ${phase} failed (exit=${code}): ${display}`);
    }
  }
}
