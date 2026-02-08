import type { AgentName, ResolvedConfig } from "./config/schema.js";
import { isValidAgent, VALID_AGENTS } from "./config/schema.js";
import { loadLocalConfig, loadGlobalConfig, resolveConfig } from "./config/loader.js";
import { ensureRunning } from "./agents/base.js";
import { COMMON_COMMANDS } from "./agents/types.js";
import * as docker from "./docker/sandbox.js";
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
    case "copilot":
    case "cagent":
      return ["--model", model, ...argv];
  }
}

function printUsage(): void {
  const lines = [
    "Usage:",
    "  agentbox ls",
    "  agentbox <agent> [ls|shell|stop]",
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
    "  - sync.files: local overrides global entirely (no merge)",
    "  - bootstrap scripts: concat (global then local)",
    "",
    "Config keys (YAML):",
    "  workspace: <path>                       # optional (defaults to agentbox.yml dir or $PWD)",
    "  startupWaitSec: <sec>                   # local only (global is defaults.startupWaitSec)",
    "  sync.files: [~/.netrc, ~/.gitconfig...]",
    "  sync.remoteWrite: true|false            # allow/disallow remote writes (readonly-remote)",
    "  network.policy: allow|deny",
    "  network.allowHosts: [host,...]          # docker sandbox network proxy --allow-host",
    "  network.blockHosts: [host,...]",
    "  network.allowCidrs: [cidr,...]",
    "  network.blockCidrs: [cidr,...]",
    "  network.bypassHosts: [host,...]",
    "  network.bypassCidrs: [cidr,...]",
    "  env: { KEY: VALUE }                     # merged by key",
    "  bootstrap.onCreateScript: <path|[...]>  # runs once when sandbox is created",
    "  bootstrap.onStartScript:  <path|[...]>  # runs on every ensureRunning()",
    "  agents.<agent>.sandboxName: <name>",
    "  agents.<agent>.credentials.enabled: true|false",
    "  agents.codex.credentials.files: [\"~/.codex/auth.json\"]",
    "  agents.<agent>.execMode: run|exec       # global only",
    "  agents.<agent>.model: <model>           # global/local",
    "  agents.<agent>.binary/defaultArgs       # global only",
    "",
    "MCP note (sandbox):",
    "  - MCP server binaries must run inside the Linux sandbox.",
    "  - Use bootstrap to install/build them in-sandbox (go install/npm/etc).",
  ];
  console.log(lines.join("\n"));
}

function agentDescription(agent: AgentName): string {
  const descriptions: Record<AgentName, string> = {
    codex: "OpenAI Codex CLI",
    claude: "Claude Code",
    kiro: "Kiro",
    gemini: "Gemini CLI",
    copilot: "GitHub Copilot",
    cagent: "Cagent",
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
    const code = docker.listAll();
    process.exit(code);
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
    const code = docker.listAll();
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
  const { sandboxName } = config.agent;
  const hasEnv = Object.keys(config.env).length > 0;
  const wantTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Reserved agentbox commands
  if (command === "shell") {
    await ensureRunning(config);
    log(`opening bash shell in ${sandboxName}`);
    const code = docker.execInteractive(sandboxName, config.workspace, ["bash"], config.env);
    process.exit(code);
  }

  if (command === "stop") {
    const code = docker.stop(sandboxName);
    log(`${sandboxName} stopped`);
    process.exit(code);
  }

  // Passthrough (default): behave like the original agent CLI.
  // - agentbox <agent>            => interactive (no args)
  // - agentbox <agent> <args...>  => passthrough
  await ensureRunning(config);
  const passthroughArgs = command ? [command, ...args] : [];

  if (passthroughArgs.length === 0) {
    log(`${agent} interactive`);
    let code: number;
    if (config.agent.execMode === "exec" || hasEnv) {
      const agentArgs = withDefaultModel(agent, [...config.agent.defaultArgs], config.agent.model);
      code = docker.execInteractive(
        sandboxName,
        config.workspace,
        [config.agent.binary!, ...agentArgs],
        config.env,
      );
    } else {
      // Keep run-mode interactive behavior unchanged; only inject model when applicable.
      const runArgs = withDefaultModel(agent, [], config.agent.model);
      code = runArgs.length > 0 ? docker.run(sandboxName, ["--", ...runArgs]) : docker.run(sandboxName);
    }
    process.exit(code);
  }

  log(`${agent} passthrough`);
  let code: number;
  if (config.agent.execMode === "exec" || hasEnv) {
    const agentArgs = withDefaultModel(
      agent,
      [...config.agent.defaultArgs, ...passthroughArgs],
      config.agent.model,
    );
    const runner = wantTty ? docker.execInteractive : docker.execNonInteractive;
    code = runner(
      sandboxName,
      config.workspace,
      [config.agent.binary!, ...agentArgs],
      config.env,
    );
  } else {
    // run-mode passthrough (no env injection support).
    // Preserve user passthrough args as-is and only inject default model.
    const runArgs = withDefaultModel(
      agent,
      [...passthroughArgs],
      config.agent.model,
    );
    code = runArgs.length > 0 ? docker.run(sandboxName, ["--", ...runArgs]) : docker.run(sandboxName);
  }
  process.exit(code);
}
