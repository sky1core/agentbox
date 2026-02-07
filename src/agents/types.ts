import type { AgentName } from "../config/schema.js";

interface AgentCommand {
  description: string;
  agentOnly?: AgentName;
  requiresArgs?: boolean;
  argsUsage?: string;
}

export const COMMON_COMMANDS: Record<string, AgentCommand> = {
  ls: { description: "List all sandboxes" },
  shell: { description: "Open bash shell in sandbox" },
  stop: { description: "Stop the sandbox" },
};
