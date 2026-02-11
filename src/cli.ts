import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import type { AgentName, ResolvedConfig } from "./config/schema.js";
import { isValidAgent, VALID_AGENTS } from "./config/schema.js";
import { loadLocalConfig, loadGlobalConfig, resolveConfig, findLocalConfigPath } from "./config/loader.js";
import { ensureRunning } from "./agents/base.js";
import { COMMON_COMMANDS } from "./agents/types.js";
import { listCustomKeychainCerts, saveCertFile } from "./runtime/certs.js";
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
    "  agentbox ca [add [--global]|ls]  # manage CA certs for corporate proxy",
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

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Update a single top-level key in a YAML file, preserving comments and formatting.
 * If the key already exists, replaces that line. Otherwise appends to the end.
 */
function updateYamlConfig(path: string, key: string, value: string): void {
  if (!existsSync(path)) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${key}: ${JSON.stringify(value)}\n`, "utf-8");
    return;
  }

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  // Match top-level key (no leading whitespace)
  const keyRegex = new RegExp(`^${key}\\s*:`);
  const idx = lines.findIndex((line) => keyRegex.test(line));

  if (idx !== -1) {
    lines[idx] = `${key}: ${JSON.stringify(value)}`;
  } else {
    // Append before trailing empty lines
    let insertAt = lines.length;
    while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, `${key}: ${JSON.stringify(value)}`);
  }
  writeFileSync(path, lines.join("\n"), "utf-8");
}

function ensureGitignore(dir: string, entry: string): void {
  const gitignorePath = join(dir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some((line) => line.trim() === entry)) return;
    writeFileSync(gitignorePath, content.trimEnd() + "\n" + entry + "\n", "utf-8");
  } else {
    writeFileSync(gitignorePath, entry + "\n", "utf-8");
  }
  log(`${gitignorePath} 에 ${entry} 추가`);
}

async function runCa(args: string[]): Promise<void> {
  const sub = args[0]; // "add", "ls", or undefined

  if (sub === "ls") {
    // Show currently configured certs
    const local = loadLocalConfig(process.cwd());
    const global = loadGlobalConfig();
    const localCert = local?.caCert;
    const globalCert = global.caCert;

    if (!localCert && !globalCert) {
      console.log("설정된 CA 인증서 없음");
      console.log("  agentbox ca add       로컬 config에 추가");
      console.log("  agentbox ca add --global  글로벌 config에 추가");
    } else {
      if (globalCert) console.log(`글로벌: ${globalCert}`);
      if (localCert) console.log(`로컬:   ${localCert}`);
    }
    return;
  }

  if (sub === "add" || !sub || sub === "--global") {
    const isGlobal = args.includes("--global");
    const certs = listCustomKeychainCerts();

    if (certs.length === 0) {
      error("System Keychain에서 커스텀 인증서를 찾을 수 없습니다");
      console.log("macOS가 아니거나, 사내 CA가 System Keychain에 설치되지 않았습니다.");
      console.log("수동 지정: config에 caCert: /path/to/cert.pem 설정");
      process.exit(1);
    }

    console.log("\nSystem Keychain 인증서 (Apple 기본 제외):\n");
    for (let i = 0; i < certs.length; i++) {
      console.log(`  ${i + 1}. ${certs[i].label}`);
    }
    console.log("");

    const answer = await prompt(
      certs.length === 1
        ? "추가할 인증서 (Enter=전체, q=취소): "
        : "추가할 번호 (쉼표 구분, Enter=전체, q=취소): ",
    );

    if (answer === "q") {
      console.log("취소됨");
      return;
    }

    let selected: typeof certs;
    if (!answer) {
      selected = certs;
    } else {
      const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1);
      selected = indices.filter((i) => i >= 0 && i < certs.length).map((i) => certs[i]);
      if (selected.length === 0) {
        error("유효한 번호가 없습니다");
        process.exit(1);
      }
    }

    // Determine workspace for local config
    const workspace = loadLocalConfig(process.cwd())?.workspace ?? process.cwd();
    const certPath = saveCertFile(selected, isGlobal, workspace);

    // Update config file
    if (isGlobal) {
      const configPath = join(homedir(), ".config", "agentbox", "config.yml");
      updateYamlConfig(configPath, "caCert", certPath);
      log(`${certPath} 저장`);
      log(`${configPath} 에 caCert 설정 추가`);
    } else {
      const configPath = findLocalConfigPath(process.cwd()) ?? join(process.cwd(), "agentbox.yml");
      updateYamlConfig(configPath, "caCert", certPath);
      log(`${certPath} 저장`);
      log(`${configPath} 에 caCert 설정 추가`);
      ensureGitignore(workspace, "agentbox-ca.pem");
    }

    console.log(`\n추가된 인증서: ${selected.map((c) => c.label).join(", ")}`);
    return;
  }

  error(`unknown ca command: ${sub}`);
  console.log("사용법: agentbox ca [add [--global] | ls]");
  process.exit(1);
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

  if (args[0] === "ca") {
    await runCa(args.slice(1));
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
