import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execWithStdinPipe, execNonInteractive } from "../docker/sandbox.js";
import { log } from "../utils/logger.js";
import { expandHome } from "./files.js";

export type BootstrapPhase = "onCreate" | "onStart";

const SANDBOX_HOME = "/home/agent";

function isWorkspaceScriptPath(p: string): boolean {
  // Treat relative paths as workspace scripts. (Includes "./foo.sh" and "scripts/foo.sh")
  return !p.startsWith("~/") && !isAbsolute(p);
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/**
 * Ensure a script exists inside the sandbox and return the sandbox path.
 *
 * - Workspace script: returned path is under the workspace.
 * - Host script (~ or absolute): injected into sandbox HOME (mirrored for ~, hashed for absolute).
 */
function prepareScriptInSandbox(
  sandboxName: string,
  workspace: string,
  scriptPath: string,
): { sandboxPath: string; display: string } {
  // Absolute paths inside the workspace should be executed as-is.
  if (isAbsolute(scriptPath) && scriptPath.startsWith(workspace)) {
    if (!existsSync(scriptPath)) {
      throw new Error(`[agentbox] bootstrap script not found: ${scriptPath}`);
    }
    return { sandboxPath: scriptPath, display: scriptPath };
  }

  if (isWorkspaceScriptPath(scriptPath)) {
    const hostPath = resolve(workspace, scriptPath);
    if (!existsSync(hostPath)) {
      throw new Error(`[agentbox] bootstrap script not found: ${scriptPath} (resolved: ${hostPath})`);
    }
    // Workspace is mounted at the same absolute path inside the sandbox.
    return { sandboxPath: hostPath, display: scriptPath };
  }

  // Host path that needs injection.
  const hostPath = expandHome(scriptPath);
  if (!existsSync(hostPath)) {
    throw new Error(`[agentbox] bootstrap script not found: ${scriptPath} (resolved: ${hostPath})`);
  }
  const content = readFileSync(hostPath);

  let sandboxPath: string;
  if (scriptPath.startsWith("~/")) {
    // Mirror under sandbox $HOME.
    sandboxPath = `${SANDBOX_HOME}/${scriptPath.slice(2)}`;
  } else {
    // Absolute host paths don't exist in sandbox; inject to a stable agentbox dir.
    const base = basename(hostPath) || "bootstrap.sh";
    sandboxPath = `${SANDBOX_HOME}/.agentbox/bootstrap/${base}.${sha1(hostPath).slice(0, 8)}.sh`;
  }

  // Write script file (no exec bit needed; we run it via bash).
  execWithStdinPipe(
    sandboxName,
    `mkdir -p "$(dirname "${sandboxPath}")" && cat > "${sandboxPath}" && chmod 600 "${sandboxPath}"`,
    content,
  );

  return { sandboxPath, display: scriptPath };
}

export function runBootstrap(
  phase: BootstrapPhase,
  sandboxName: string,
  workspace: string,
  scripts: string[],
  env: Record<string, string>,
): void {
  if (scripts.length === 0) return;

  for (const scriptPath of scripts) {
    const { sandboxPath, display } = prepareScriptInSandbox(
      sandboxName,
      workspace,
      scriptPath,
    );
    log(`bootstrap ${phase}: ${display}`);

    // Run via interpreter so sync chmod doesn't matter and exec bit is not required.
    const code = execNonInteractive(
      sandboxName,
      workspace,
      ["bash", "-euo", "pipefail", sandboxPath],
      env,
    );
    if (code !== 0) {
      throw new Error(`[agentbox] bootstrap ${phase} failed (exit=${code}): ${display}`);
    }
  }
}
