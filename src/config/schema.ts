export type AgentName = "codex" | "claude" | "kiro" | "gemini";

export interface AgentGlobalConfig {
  binary?: string;
  defaultArgs?: string[];
  /**
   * Default model name to use for the agent (injected as CLI flags automatically).
   */
  model?: string;
}

/**
 * Bootstrap scripts that run inside the VM before launching the agent CLI.
 *
 * - onCreateScript: runs only when the VM is first created
 * - onStartScript: runs whenever agentbox ensures the VM is running (including first create)
 */
export interface BootstrapConfig {
  onCreateScript?: string | string[];
  onStartScript?: string | string[];
}

/** Lima VM resource configuration. */
export interface VmConfig {
  cpus?: number;
  memory?: string;  // e.g. "8GiB"
  disk?: string;    // e.g. "50GiB"
}

/** Additional mount point (beyond workspace and credential auto-mounts). */
export interface MountConfig {
  location: string;
  mountPoint?: string;
  writable?: boolean;
}

export interface GlobalConfig {
  sync?: {
    remoteWrite?: boolean;
  };
  vm?: VmConfig;
  mounts?: MountConfig[];
  defaults?: {
    startupWaitSec?: number;
  };
  env?: Record<string, string>;
  bootstrap?: BootstrapConfig;
  caCert?: string;
  agents?: Partial<Record<AgentName, AgentGlobalConfig>>;
}

export interface AgentLocalConfig {
  vmName?: string;
  model?: string;
}

export interface LocalConfig {
  workspace?: string;
  sync?: {
    remoteWrite?: boolean;
  };
  vm?: VmConfig;
  mounts?: MountConfig[];
  startupWaitSec?: number;
  env?: Record<string, string>;
  bootstrap?: BootstrapConfig;
  caCert?: string;
  agents?: Partial<Record<AgentName, AgentLocalConfig>>;
}

export interface ResolvedConfig {
  workspace: string;
  remoteWrite: boolean;
  vm: Required<VmConfig>;
  mounts: MountConfig[];
  startupWaitSec: number;
  env: Record<string, string>;
  caCerts: string;
  bootstrap: {
    onCreateScripts: string[];
    onStartScripts: string[];
  };
  agent: {
    name: AgentName;
    binary?: string;
    defaultArgs: string[];
    model?: string;
    vmName: string;
  };
}

export const VALID_AGENTS: AgentName[] = ["codex", "claude", "kiro", "gemini"];

export function isValidAgent(name: string): name is AgentName {
  return VALID_AGENTS.includes(name as AgentName);
}
