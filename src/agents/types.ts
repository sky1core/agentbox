import type { AgentName } from "../config/schema.js";

interface AgentCommand {
  description: string;
  agentOnly?: AgentName;
  requiresArgs?: boolean;
  argsUsage?: string;
}

export const COMMON_COMMANDS: Record<string, AgentCommand> = {
  ls: { description: "List all VMs" },
  shell: { description: "Open bash shell in VM" },
  stop: { description: "Stop the VM" },
  rm: { description: "Delete the VM" },
};
