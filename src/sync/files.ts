import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { execWithStdinPipe } from "../docker/sandbox.js";
import { log } from "../utils/logger.js";

/**
 * Expand ~ to home directory.
 */
export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

/**
 * Sync files from host to sandbox via stdin piping.
 * Each entry is a path like "~/.netrc" or "~/.gitconfig".
 * Files are written to the same path inside the sandbox.
 */
export function syncFiles(sandboxName: string, files: string[]): void {
  for (const raw of files) {
    const hostPath = expandHome(raw);
    if (!existsSync(hostPath)) {
      log(`skip ${raw} (not found)`);
      continue;
    }

    log(`syncing ${raw}`);
    const content = readFileSync(hostPath);
    // Use $HOME instead of ~ so tilde expansion works inside double quotes
    const sandboxPath = raw.startsWith("~/")
      ? `$HOME/${raw.slice(2)}`
      : raw;
    execWithStdinPipe(
      sandboxName,
      `mkdir -p "$(dirname "${sandboxPath}")" && cat > "${sandboxPath}" && chmod 600 "${sandboxPath}"`,
      content,
    );
  }
}
