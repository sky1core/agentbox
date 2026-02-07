import type { AgentGlobalConfig, AgentName, GlobalConfig } from "./schema.js";

const AGENT_DEFAULTS: Record<AgentName, AgentGlobalConfig> = {
  codex: { execMode: "exec", binary: "codex", defaultArgs: ["--ask-for-approval", "never"] },
  claude: { execMode: "run", binary: "claude", defaultArgs: ["--dangerously-skip-permissions"] },
  kiro: { execMode: "run", binary: "kiro-cli", defaultArgs: ["chat", "--trust-all-tools"] },
  gemini: { execMode: "exec", binary: "gemini", defaultArgs: ["-y"] },
  copilot: { execMode: "run", binary: "copilot" },
  cagent: { execMode: "run", binary: "cagent" },
};

export const DEFAULT_GLOBAL_CONFIG: Required<
  Pick<GlobalConfig, "sync" | "defaults">
> & { agents: Record<AgentName, AgentGlobalConfig> } = {
  sync: { files: [], remoteWrite: false },
  defaults: { startupWaitSec: 5 },
  agents: AGENT_DEFAULTS,
};

export function getAgentDefaults(agent: AgentName): AgentGlobalConfig {
  return AGENT_DEFAULTS[agent];
}
