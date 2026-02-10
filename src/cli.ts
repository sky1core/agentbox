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
    "Passthrough examples:",
    "  agentbox codex --help",
    "  agentbox claude prompt \"hello\"",
    "",
    "Config discovery (optional):",
    "  - Local: search upward from $PWD for agentbox.yml",
    "  - Global: ~/.config/agentbox/config.yml",
    "  - If local config is missing, workspace defaults to $PWD",
    "",
    "Config merge rules:",
    "  - env: merge by key (global -> local override)",
    "  - mounts: local overrides global entirely",
    "  - bootstrap scripts: concat (global then local)",
    "",
    "Config keys (YAML):",
    "  workspace: <path>                       # optional (defaults to agentbox.yml dir or $PWD)",
    "  startupWaitSec: <sec>                   # local only (global is defaults.startupWaitSec)",
    "  vm: { cpus, memory, disk }              # Lima VM resources",
    "  mounts: [{ location, mountPoint, writable }]",
    "  sync.remoteWrite: true|false            # allow/disallow remote writes (readonly-remote)",
    "  env: { KEY: VALUE }                     # merged by key",
    "  bootstrap.onCreateScript: <path|[...]>  # runs once when VM is created",
    "  bootstrap.onStartScript:  <path|[...]>  # runs on every ensureRunning()",
    "  agents.<agent>.vmName: <name>",
    "  agents.<agent>.model: <model>           # global/local",
    "  agents.<agent>.binary/defaultArgs       # global only",
  ];
  console.log(lines.join("\n"));
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

  // Top-level VM commands (no agent needed — VM is per-workspace, not per-agent)
  const VM_COMMANDS = ["stop", "rm", "shell"] as const;
  if (VM_COMMANDS.includes(args[0] as (typeof VM_COMMANDS)[number])) {
    const local = loadLocalConfig(process.cwd()) ?? { workspace: process.cwd() };
    const global = loadGlobalConfig();
    const config = resolveConfig("codex", local, global);
    const { vmName } = config.agent;

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
      await ensureRunning(config);
      log(`opening bash shell in ${vmName}`);
      const code = lima.shellInteractive(vmName, config.workspace, ["bash"], config.env);
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
    log(`opening bash shell in ${vmName}`);
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
    const agentArgs = withDefaultModel(agent, [...config.agent.defaultArgs], config.agent.model);
    const code = lima.shellInteractive(vmName, config.workspace, [binary, ...agentArgs], config.env);
    process.exit(code);
  }

  // Passthrough: binary + defaultArgs + user args
  log(`${agent} passthrough`);
  const agentArgs = withDefaultModel(
    agent,
    [...config.agent.defaultArgs, ...passthroughArgs],
    config.agent.model,
  );
  const runner = wantTty ? lima.shellInteractive : lima.shellNonInteractive;
  const code = runner(vmName, config.workspace, [binary, ...agentArgs], config.env);
  process.exit(code);
}
