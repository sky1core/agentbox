import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import type {
  AgentName,
  GlobalConfig,
  LocalConfig,
  MountConfig,
  ResolvedConfig,
} from "./schema.js";
import { DEFAULT_GLOBAL_CONFIG, DEFAULT_VM_CONFIG, getAgentDefaults } from "./defaults.js";
import { collectCACerts } from "../runtime/certs.js";

const GLOBAL_CONFIG_PATH = join(
  homedir(),
  ".config",
  "agentbox",
  "config.yml",
);
const LOCAL_CONFIG_NAME = "agentbox.yml";

function loadYamlFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  return parseYaml(content) as T;
}

export function loadGlobalConfig(): GlobalConfig {
  return loadYamlFile<GlobalConfig>(GLOBAL_CONFIG_PATH) ?? {};
}

/**
 * Search upward from startDir for agentbox.yml
 */
export function findLocalConfigPath(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, LOCAL_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadLocalConfig(startDir: string): LocalConfig | null {
  const configPath = findLocalConfigPath(startDir);
  if (!configPath) return null;
  const config = loadYamlFile<LocalConfig>(configPath) ?? {};
  if (!config.workspace) {
    config.workspace = dirname(configPath);
  }
  return config;
}

/**
 * Merge: hardcoded defaults → global config → local config → produce ResolvedConfig
 */
export function resolveConfig(
  agent: AgentName,
  local: LocalConfig,
  global: GlobalConfig = loadGlobalConfig(),
): ResolvedConfig {
  const normalizeScripts = (v?: string | string[]): string[] => {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  };

  const agentDefaults = getAgentDefaults(agent);
  const globalAgent = global.agents?.[agent];
  const localAgent = local.agents?.[agent];

  const remoteWrite: boolean =
    local.sync?.remoteWrite ??
    global.sync?.remoteWrite ??
    DEFAULT_GLOBAL_CONFIG.sync.remoteWrite ??
    false;

  const vm = {
    cpus: local.vm?.cpus ?? global.vm?.cpus ?? DEFAULT_VM_CONFIG.cpus,
    memory: local.vm?.memory ?? global.vm?.memory ?? DEFAULT_VM_CONFIG.memory,
    disk: local.vm?.disk ?? global.vm?.disk ?? DEFAULT_VM_CONFIG.disk,
  };

  // Mounts: local overrides global entirely (no merge)
  const mounts: MountConfig[] = local.mounts ?? global.mounts ?? [];

  const startupWaitSec: number =
    local.startupWaitSec ??
    global.defaults?.startupWaitSec ??
    DEFAULT_GLOBAL_CONFIG.defaults.startupWaitSec!;

  const binary = globalAgent?.binary ?? agentDefaults.binary;
  const defaultArgs = globalAgent?.defaultArgs ?? agentDefaults.defaultArgs ?? [];
  const model = localAgent?.model ?? globalAgent?.model;

  const env: Record<string, string> = {
    ...global.env,
    ...local.env,
  };

  const caCertPath = local.caCert ?? global.caCert;
  const caCerts = collectCACerts(caCertPath);

  // If custom CA certs are present, ensure NODE_EXTRA_CA_CERTS is set at runtime.
  // /etc/profile.d/ is not sourced by non-login SSH shells (shellInteractive, shellNonInteractive),
  // so we inject it into env to flow through buildShellCmd and sandbox-persistent.sh.
  if (caCerts && !env.NODE_EXTRA_CA_CERTS) {
    env.NODE_EXTRA_CA_CERTS = "/etc/ssl/certs/ca-certificates.crt";
  }

  const onCreateScripts = [
    ...normalizeScripts(global.bootstrap?.onCreateScript),
    ...normalizeScripts(local.bootstrap?.onCreateScript),
  ];
  const onStartScripts = [
    ...normalizeScripts(global.bootstrap?.onStartScript),
    ...normalizeScripts(local.bootstrap?.onStartScript),
  ];

  const workspace = local.workspace!;
  const project = basename(workspace);
  const vmName = localAgent?.vmName ?? `agentbox-${project}`;

  return {
    workspace,
    remoteWrite,
    vm,
    mounts,
    startupWaitSec,
    env,
    caCerts,
    bootstrap: { onCreateScripts, onStartScripts },
    agent: {
      name: agent,
      binary,
      defaultArgs,
      model,
      vmName,
    },
  };
}
