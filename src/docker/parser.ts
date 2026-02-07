export type SandboxState = "running" | "stopped" | "";

/**
 * Parse `docker sandbox ls` output.
 * Format (no --format support):
 *   NAME              AGENT    STATUS
 *   codex-myproj      codex    running
 */
export function parseSandboxState(
  lsOutput: string,
  sandboxName: string,
): SandboxState {
  for (const line of lsOutput.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === sandboxName) {
      const status = cols[2]?.toLowerCase();
      if (status === "running") return "running";
      if (status === "stopped") return "stopped";
      return "";
    }
  }
  return "";
}
