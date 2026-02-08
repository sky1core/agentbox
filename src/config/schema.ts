export type AgentName = "codex" | "claude" | "kiro" | "gemini" | "copilot" | "cagent";

export type ExecMode = "run" | "exec";
export type NetworkPolicy = "allow" | "deny";

export interface NetworkProxyConfig {
  policy?: NetworkPolicy;
  allowHosts?: string[];
  blockHosts?: string[];
  allowCidrs?: string[];
  blockCidrs?: string[];
  bypassHosts?: string[];
  bypassCidrs?: string[];
}

export interface AgentGlobalConfig {
  execMode: ExecMode;
  binary?: string;
  defaultArgs?: string[];
  /**
   * Default model name to use for the agent (injected as CLI flags automatically).
   *
   * NOTE: This is intentionally a plain string. Each agent may interpret model
   * names differently (aliases vs full IDs). agentbox maps this to the correct
   * per-agent CLI flag where supported.
   */
  model?: string;
  credentials?: AgentCredentialsConfig;
}

/**
 * Agent credential injection behavior.
 *
 * - enabled: whether agentbox should try to auto-inject credentials for this agent.
 * - files: optional host-side files to copy into the sandbox (codex uses this by default).
 */
export interface AgentCredentialsConfig {
  enabled?: boolean;
  files?: string[];
}

/**
 * Bootstrap scripts that run inside the sandbox before launching the agent CLI.
 *
 * - onCreateScript: runs only when the sandbox is created (state == "not found")
 * - onStartScript: runs whenever agentbox ensures the sandbox is running (including first create)
 *
 * Scripts can be specified as a single string or an array of strings.
 *
 * NOTE: Script path semantics are implemented in sync/bootstrap.ts.
 */
export interface BootstrapConfig {
  onCreateScript?: string | string[];
  onStartScript?: string | string[];
}

export interface GlobalConfig {
  sync?: {
    files?: string[];
    remoteWrite?: boolean;
  };
  network?: NetworkProxyConfig;
  defaults?: {
    startupWaitSec?: number;
  };
  env?: Record<string, string>;
  bootstrap?: BootstrapConfig;
  agents?: Partial<Record<AgentName, AgentGlobalConfig>>;
}

export interface AgentLocalConfig {
  sandboxName?: string;
  /**
   * Per-project override for the default model (merged as: global -> local).
   */
  model?: string;
  credentials?: AgentCredentialsConfig;
}

export interface LocalConfig {
  workspace?: string;
  sync?: {
    files?: string[];
    remoteWrite?: boolean;
  };
  network?: NetworkProxyConfig;
  startupWaitSec?: number;
  env?: Record<string, string>;
  bootstrap?: BootstrapConfig;
  agents?: Partial<Record<AgentName, AgentLocalConfig>>;
}

export interface ResolvedConfig {
  workspace: string;
  syncFiles: string[];
  remoteWrite?: boolean;
  networkProxy: {
    policy?: NetworkPolicy;
    allowHosts: string[];
    blockHosts: string[];
    allowCidrs: string[];
    blockCidrs: string[];
    bypassHosts: string[];
    bypassCidrs: string[];
  };
  startupWaitSec: number;
  env: Record<string, string>;
  bootstrap: {
    onCreateScripts: string[];
    onStartScripts: string[];
  };
  agent: {
    name: AgentName;
    execMode: ExecMode;
    binary?: string;
    defaultArgs: string[];
    model?: string;
    sandboxName: string;
    credentials: {
      enabled: boolean;
      files: string[];
    };
  };
}

export const VALID_AGENTS: AgentName[] = ["codex", "claude", "kiro", "gemini", "copilot", "cagent"];

export function isValidAgent(name: string): name is AgentName {
  return VALID_AGENTS.includes(name as AgentName);
}
