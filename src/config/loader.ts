import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import type {
  AgentName,
  GlobalConfig,
  LocalConfig,
  ResolvedConfig,
} from "./schema.js";
import { DEFAULT_GLOBAL_CONFIG, getAgentDefaults } from "./defaults.js";

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
 * Search upward from startDir for sandbox.yml
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

  // local files override global files entirely (no merge)
  const syncFiles: string[] =
    local.sync?.files ?? global.sync?.files ?? [];

  const remoteWrite: boolean =
    local.sync?.remoteWrite ??
    global.sync?.remoteWrite ??
    DEFAULT_GLOBAL_CONFIG.sync.remoteWrite ??
    false;

  const startupWaitSec: number =
    local.startupWaitSec ??
    global.defaults?.startupWaitSec ??
    DEFAULT_GLOBAL_CONFIG.defaults.startupWaitSec!;

  const execMode =
    globalAgent?.execMode ?? agentDefaults.execMode;

  const binary =
    globalAgent?.binary ?? agentDefaults.binary;

  const defaultArgs =
    globalAgent?.defaultArgs ?? agentDefaults.defaultArgs ?? [];

  const model =
    localAgent?.model ?? globalAgent?.model;

  const credentialsEnabled: boolean =
    localAgent?.credentials?.enabled ??
    globalAgent?.credentials?.enabled ??
    true;

  const defaultCredentialFiles: string[] =
    agent === "codex"
      ? ["~/.codex/auth.json"]
      : [];

  const credentialsFiles: string[] =
    localAgent?.credentials?.files ??
    globalAgent?.credentials?.files ??
    defaultCredentialFiles;

  const env: Record<string, string> = {
    ...global.env,
    ...local.env,
  };

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
  const sandboxName =
    localAgent?.sandboxName ?? `${agent}-${project}`;

  return {
    workspace,
    syncFiles,
    remoteWrite,
    startupWaitSec,
    env,
    bootstrap: { onCreateScripts, onStartScripts },
    agent: {
      name: agent,
      execMode,
      binary,
      defaultArgs,
      model,
      sandboxName,
      credentials: { enabled: credentialsEnabled, files: credentialsFiles },
    },
  };
}
