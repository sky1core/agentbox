import type { AgentGlobalConfig, AgentName, GlobalConfig, VmConfig } from "./schema.js";

const AGENT_DEFAULTS: Record<AgentName, AgentGlobalConfig> = {
  codex: { binary: "codex", defaultArgs: ["--dangerously-bypass-approvals-and-sandbox"] },
  claude: { binary: "claude", defaultArgs: ["--dangerously-skip-permissions"] },
  kiro: { binary: "kiro-cli", defaultArgs: ["chat", "--trust-all-tools"] },
  gemini: { binary: "gemini", defaultArgs: ["--approval-mode=yolo", "--no-sandbox"] },
};

export const DEFAULT_VM_CONFIG: Required<VmConfig> = {
  cpus: 4,
  memory: "8GiB",
  disk: "20GiB",
};

export const DEFAULT_GLOBAL_CONFIG: Required<
  Pick<GlobalConfig, "sync" | "defaults">
> & { agents: Record<AgentName, AgentGlobalConfig> } = {
  sync: { remoteWrite: false },
  defaults: { startupWaitSec: 5 },
  agents: AGENT_DEFAULTS,
};

export function getAgentDefaults(agent: AgentName): AgentGlobalConfig {
  return AGENT_DEFAULTS[agent];
}
