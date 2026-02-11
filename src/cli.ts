import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import type { AgentName, ResolvedConfig } from "./config/schema.js";
import { isValidAgent, VALID_AGENTS } from "./config/schema.js";
import { loadLocalConfig, loadGlobalConfig, resolveConfig } from "./config/loader.js";
import { ensureRunning } from "./agents/base.js";
import { COMMON_COMMANDS } from "./agents/types.js";
import * as lima from "./runtime/lima.js";
import { log, error } from "./utils/logger.js";

function hasModelFlag(argv: string[]): boolean {
  return argv.some((arg) => arg === "--model" || arg.startsWith("--model=") || arg === "-m");
}

export function withDefaultModel(agent: AgentName, argv: string[], model?: string): string[] {
  if (!model) return argv;

  // Don't double-inject if the user already passed it through.
  if (hasModelFlag(argv)) return argv;

  switch (agent) {
    case "kiro": {
      // Kiro's --model is a `chat` subcommand option (not a global option).
      // Insert right after the `chat` token if present; otherwise, leave untouched.
      const chatIdx = argv.indexOf("chat");
      if (chatIdx === -1) return argv;
      return [...argv.slice(0, chatIdx + 1), "--model", model, ...argv.slice(chatIdx + 1)];
    }
    // These CLIs accept --model at the top-level.
    case "codex":
    case "claude":
    case "gemini":
      return ["--model", model, ...argv];
  }
}

function printUsage(): void {
  const lines = [
    "Usage:",
    "  agentbox init [--global]         # generate config template",
    "  agentbox ls|stop|rm|shell        # VM-level commands (no agent needed)",
    "  agentbox <agent>                 # interactive (no args)",
    "  agentbox <agent> <args...>       # passthrough to the agent CLI",
    "  agentbox --help",
    "",
    "Agents:",
    ...VALID_AGENTS.map((a) => `  ${a.padEnd(10)} ${agentDescription(a)}`),
    "",
    "Reserved commands (agentbox):",
    ...Object.entries(COMMON_COMMANDS).map(
      ([k, v]) => `  ${k.padEnd(14)} ${v.description}`,
    ),
    "",
    "Examples:",
    "  agentbox claude                    # interactive Claude session",
    "  agentbox codex --help              # passthrough to codex CLI",
    "  agentbox claude prompt \"hello\"     # one-shot prompt",
    "  agentbox shell                     # bash shell in VM",
    "  agentbox init                      # create agentbox.yml template",
    "",
    "Config discovery (optional — agentbox works without any config):",
    "  - Local: search upward from $PWD for agentbox.yml",
    "  - Global: ~/.config/agentbox/config.yml",
    "  - Merge order: defaults -> global -> local (local wins)",
    "",
    "Config merge rules:",
    "  - env: merge by key (global -> local override)",
    "  - mounts: local replaces global entirely",
    "  - bootstrap scripts: concat (global then local)",
    "  - all others: local overrides global",
    "",
    "Config keys (YAML):",
    "  workspace: <path>                       # defaults to agentbox.yml dir or $PWD",
    "  startupWaitSec: <sec>                   # SSH readiness timeout (default: 30)",
    "  vm: { cpus, memory, disk }              # Lima VM resources (default: 4, 8GiB, 50GiB)",
    "  mounts: [{ location, mountPoint, writable }]  # additional host dirs to mount",
    "  sync.remoteWrite: true|false            # allow git push (default: false = blocked)",
    "  env: { KEY: VALUE }                     # env vars injected into VM",
    "  bootstrap.onCreateScript: <path|[...]>  # runs once on VM creation",
    "  bootstrap.onStartScript:  <path|[...]>  # runs every VM start",
    "  agents.<agent>.vmName: <name>           # override VM name",
    "  agents.<agent>.model: <model>           # default model for agent",
    "  caCert: /path/to/cert.pem               # custom CA cert for corporate proxy",
    "  agents.<agent>.binary/defaultArgs       # global only",
    "",
    "Credentials (auto-injected via limactl copy — host ~ is NOT mounted):",
    "  .gitconfig, .netrc, .claude/.credentials.json, .claude.json,",
    "  .codex/auth.json, .config/gh/*, .gemini/*",
    "",
    "Bootstrap (run custom scripts before agent launch):",
    "  Relative paths run from workspace (mounted in VM at same path).",
    "  Absolute/~ paths are copied from host to VM, then executed.",
    "  Use for: MCP server build, go install, pip install, etc.",
    "  Example agentbox.yml:",
    "    bootstrap:",
    "      onCreateScript: ./scripts/setup.sh",
    "      onStartScript: ./scripts/start-mcp.sh",
    "",
    "MCP servers in sandbox:",
    "  VM runs Linux (Ubuntu 24.04). MCP binaries must be Linux-compatible.",
    "  Build/install via bootstrap scripts. Example:",
    "    bootstrap:",
    "      onCreateScript: |",
    "        go install github.com/example/mcp-server@latest",
  ];
  console.log(lines.join("\n"));
}

const LOCAL_TEMPLATE = `# agentbox.yml — project-level config
# workspace: /path/to/project   # defaults to this file's directory

# vm:
#   cpus: 4
#   memory: "8GiB"
#   disk: "20GiB"

# mounts:
#   - location: "~/datasets"
#     mountPoint: "/mnt/datasets"
#     writable: false

# sync:
#   remoteWrite: false           # block git push (default)

# env:
#   MY_VAR: "value"

# startupWaitSec: 30

# caCert: /path/to/corporate-ca.pem  # custom CA cert for HTTPS proxy

# bootstrap:
#   onCreateScript: ./scripts/setup.sh
#   onStartScript: ./scripts/start.sh

# agents:
#   codex:
#     model: o3
`;

const GLOBAL_TEMPLATE = `# ~/.config/agentbox/config.yml — global config (applies to all projects)

# vm:
#   cpus: 4
#   memory: "8GiB"
#   disk: "50GiB"

# sync:
#   remoteWrite: false

# env:
#   CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."

# defaults:
#   startupWaitSec: 30

# caCert: /path/to/corporate-ca.pem  # custom CA cert for HTTPS proxy

# agents:
#   codex:
#     binary: codex
#   claude:
#     model: sonnet
`;

function runInit(args: string[]): void {
  const isGlobal = args.includes("--global");

  if (isGlobal) {
    const dir = join(homedir(), ".config", "agentbox");
    const path = join(dir, "config.yml");
    if (existsSync(path)) {
      error(`already exists: ${path}`);
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, GLOBAL_TEMPLATE, "utf-8");
    log(`created ${path}`);
  } else {
    const path = join(process.cwd(), "agentbox.yml");
    if (existsSync(path)) {
      error(`already exists: ${path}`);
      process.exit(1);
    }
    writeFileSync(path, LOCAL_TEMPLATE, "utf-8");
    log(`created ${path}`);
  }
}

function agentDescription(agent: AgentName): string {
  const descriptions: Record<AgentName, string> = {
    codex: "OpenAI Codex CLI",
    claude: "Claude Code",
    kiro: "Kiro",
    gemini: "Gemini CLI",
  };
  return descriptions[agent];
}

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2); // strip node and script path

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args[0] === "ls") {
    const code = lima.listAll();
    process.exit(code);
  }

  if (args[0] === "init") {
    runInit(args.slice(1));
    process.exit(0);
  }

  // Top-level VM commands (no agent needed — VM is per-workspace, not per-agent)
  const VM_COMMANDS = ["stop", "rm", "shell"] as const;
  if (VM_COMMANDS.includes(args[0] as (typeof VM_COMMANDS)[number])) {
    const local = loadLocalConfig(process.cwd()) ?? { workspace: process.cwd() };
    const global = loadGlobalConfig();
    const workspace = local.workspace!;
    // Top-level commands use the default VM name, not agent-specific overrides
    const vmName = `agentbox-${basename(workspace)}`;

    if (args[0] === "stop") {
      const code = lima.stop(vmName);
      log(`${vmName} stopped`);
      process.exit(code);
    }
    if (args[0] === "rm") {
      const code = lima.remove(vmName);
      log(`${vmName} removed`);
      process.exit(code);
    }
    if (args[0] === "shell") {
      // Still need full config for ensureRunning (credentials, env, bootstrap)
      const config = resolveConfig("codex", local, global);
      config.agent.vmName = vmName;
      await ensureRunning(config);
      printSandboxBanner(vmName, workspace);
      setTerminalTitle(`[agentbox] ${vmName}`);
      const code = lima.shellInteractive(vmName, workspace, ["bash"], config.env);
      process.exit(code);
    }
  }

  const agentArg = args[0];
  if (!isValidAgent(agentArg)) {
    error(`unknown agent: ${agentArg}`);
    printUsage();
    process.exit(1);
  }
  const agent: AgentName = agentArg;

  const command = args[1]; // optional
  const commandArgs = args.slice(2);

  // ls doesn't need config
  if (command === "ls") {
    const code = lima.listAll();
    process.exit(code);
  }

  // Load config (agentbox.yml is optional — defaults to cwd as workspace)
  const local = loadLocalConfig(process.cwd()) ?? { workspace: process.cwd() };

  const global = loadGlobalConfig();
  const config = resolveConfig(agent, local, global);

  try {
    await dispatch(agent, command, commandArgs, config);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

function setTerminalTitle(title: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]2;${title}\x07`);
  }
}

function printSandboxBanner(vmName: string, workspace: string): void {
  if (!process.stdout.isTTY) return;
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const reset = "\x1b[0m";
  console.log(`${dim}────────────────────────────────────────${reset}`);
  console.log(`${bold}${cyan}[agentbox]${reset} ${bold}${vmName}${reset}`);
  console.log(`${dim}workspace: ${workspace}${reset}`);
  console.log(`${dim}────────────────────────────────────────${reset}`);
}

export async function dispatch(
  agent: AgentName,
  command: string | undefined,
  args: string[],
  config: ResolvedConfig,
): Promise<void> {
  const { vmName } = config.agent;
  const wantTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Reserved agentbox commands
  if (command === "shell") {
    await ensureRunning(config);
    printSandboxBanner(vmName, config.workspace);
    setTerminalTitle(`[agentbox] ${vmName}`);
    const code = lima.shellInteractive(vmName, config.workspace, ["bash"], config.env);
    process.exit(code);
  }

  if (command === "stop") {
    const code = lima.stop(vmName);
    log(`${vmName} stopped`);
    process.exit(code);
  }

  if (command === "rm") {
    const code = lima.remove(vmName);
    log(`${vmName} removed`);
    process.exit(code);
  }

  // Passthrough: all agents use limactl shell with binary + args.
  await ensureRunning(config);
  const passthroughArgs = command ? [command, ...args] : [];

  const binary = config.agent.binary ?? config.agent.name;

  if (passthroughArgs.length === 0) {
    // Interactive: binary + defaultArgs
    log(`${agent} interactive`);
    printSandboxBanner(vmName, config.workspace);
    setTerminalTitle(`[agentbox] ${vmName} — ${agent}`);
    const agentArgs = withDefaultModel(agent, [...config.agent.defaultArgs], config.agent.model);
    const code = lima.shellInteractive(vmName, config.workspace, [binary, ...agentArgs], config.env);
    process.exit(code);
  }

  // Passthrough: binary + defaultArgs + user args
  log(`${agent} passthrough`);
  if (wantTty) setTerminalTitle(`[agentbox] ${vmName} — ${agent}`);
  const agentArgs = withDefaultModel(
    agent,
    [...config.agent.defaultArgs, ...passthroughArgs],
    config.agent.model,
  );
  const runner = wantTty ? lima.shellInteractive : lima.shellNonInteractive;
  const code = runner(vmName, config.workspace, [binary, ...agentArgs], config.env);
  process.exit(code);
}
