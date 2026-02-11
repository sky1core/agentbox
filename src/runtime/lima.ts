import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execInherit, execCapture } from "../utils/process.js";
import { log } from "../utils/logger.js";
import type { ResolvedConfig, MountConfig } from "../config/schema.js";

export type VmState = "Running" | "Stopped" | "Broken" | "";

interface LimaInstance {
  name: string;
  status: string;
  dir: string;
  vmType: string;
  arch: string;
  cpus: number;
  memory: number;
  disk: number;
  sshLocalPort: number;
}

/**
 * Query VM state via `limactl list --json`.
 */
export function getState(vmName: string): VmState {
  const result = execCapture("limactl", ["list", "--json", vmName]);
  if (result.status !== 0) return "";

  // limactl list --json outputs JSON Lines (one object per line)
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const instance = JSON.parse(trimmed) as LimaInstance;
      if (instance.name === vmName) {
        const s = instance.status;
        if (s === "Running" || s === "Stopped" || s === "Broken") return s;
        return "";
      }
    } catch {
      // skip invalid lines
    }
  }
  return "";
}

/**
 * List all Lima VMs (table output to stdout).
 */
export function listAll(): number {
  return execInherit("limactl", ["list"]);
}

/**
 * Build a Lima YAML template string from a ResolvedConfig.
 */
export function buildTemplate(config: ResolvedConfig): string {
  const lines: string[] = [];

  lines.push('vmType: "vz"');
  lines.push('arch: "default"');
  lines.push("");

  // Resources
  lines.push(`cpus: ${config.vm.cpus}`);
  lines.push(`memory: "${config.vm.memory}"`);
  lines.push(`disk: "${config.vm.disk}"`);
  lines.push("");

  // Images — Ubuntu 24.04 LTS
  lines.push("images:");
  lines.push('  - location: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img"');
  lines.push('    arch: "aarch64"');
  lines.push('  - location: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"');
  lines.push('    arch: "x86_64"');
  lines.push("");

  // VZ options (Rosetta for x86 compat on Apple Silicon)
  lines.push("vmOpts:");
  lines.push("  vz:");
  lines.push("    rosetta:");
  lines.push("      enabled: true");
  lines.push("      binfmt: true");
  lines.push("");

  // CA Certificates (injected before provision so HTTPS works in provision scripts)
  if (config.caCerts) {
    lines.push("caCerts:");
    lines.push("  certs:");
    // Split PEM into individual cert blocks; each becomes a YAML block scalar list item
    const certBlocks = config.caCerts.split(/(?=-----BEGIN CERTIFICATE-----)/).filter((b) => b.trim());
    for (const block of certBlocks) {
      lines.push("    - |");
      for (const line of block.trim().split("\n")) {
        lines.push(`      ${line}`);
      }
    }
    lines.push("");
  }

  // Mounts — workspace only (credentials are injected via limactl copy, NOT by mounting ~)
  lines.push("mounts:");

  // Workspace — writable
  lines.push(`  - location: "${config.workspace}"`);
  lines.push(`    mountPoint: "${config.workspace}"`);
  lines.push("    writable: true");

  // User-specified additional mounts
  for (const m of config.mounts) {
    lines.push(`  - location: "${m.location}"`);
    if (m.mountPoint) lines.push(`    mountPoint: "${m.mountPoint}"`);
    lines.push(`    writable: ${m.writable ?? false}`);
  }
  lines.push("");

  // Provision — Phase 1: System packages (root)
  lines.push("provision:");
  lines.push("  - mode: system");
  lines.push("    script: |");
  lines.push("      #!/bin/bash");
  lines.push("      set -eux -o pipefail");
  lines.push("      export DEBIAN_FRONTEND=noninteractive");
  if (config.caCerts) {
    // Make NODE_EXTRA_CA_CERTS available for all provision phases and runtime
    lines.push('      export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt');
    lines.push('      echo \'export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt\' > /etc/profile.d/node-ca-certs.sh');
  }
  lines.push("      apt-get update");
  lines.push("      apt-get install -y curl git build-essential unzip jq docker.io");
  lines.push("      # Add the Lima guest user to docker group (resolve inside VM)");
  lines.push("      . /run/lima-cidata/lima.env");
  lines.push('      usermod -aG docker "$LIMA_CIDATA_USER" || true');
  lines.push("      systemctl enable docker");
  lines.push("");

  // Phase 2: Node.js, gh CLI (root)
  lines.push("  - mode: system");
  lines.push("    script: |");
  lines.push("      #!/bin/bash");
  lines.push("      set -eux -o pipefail");
  if (config.caCerts) {
    lines.push('      export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt');
  }
  lines.push("      # Node.js 22 LTS — official binary from nodejs.org");
  lines.push("      NODE_VER=v22.22.0");
  lines.push('      ARCH=$(dpkg --print-architecture)');
  lines.push('      if [ "$ARCH" = "arm64" ]; then NODE_ARCH=arm64; else NODE_ARCH=x64; fi');
  lines.push('      curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-${NODE_ARCH}.tar.xz" | tar -xJ -C /usr/local --strip-components=1');
  lines.push("      # gh CLI");
  lines.push("      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg");
  lines.push('      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list');
  lines.push("      apt-get update && apt-get install -y gh");
  lines.push("      # Ensure ~/.local/bin is in PATH for all users");
  lines.push('      echo \'export PATH="$HOME/.local/bin:$PATH"\' > /etc/profile.d/local-bin.sh');
  lines.push("");

  // Phase 3: Agent CLIs (root — npm install -g needs root)
  lines.push("  - mode: system");
  lines.push("    script: |");
  lines.push("      #!/bin/bash");
  lines.push("      set -eux -o pipefail");
  if (config.caCerts) {
    lines.push('      export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt');
  }
  lines.push("      npm install -g @anthropic-ai/claude-code || true");
  lines.push("      npm install -g @openai/codex || true");
  lines.push("      npm install -g @google/gemini-cli || true");
  lines.push("");

  // Phase 4: Approval-free settings + credential symlinks (user)
  lines.push("  - mode: user");
  lines.push("    script: |");
  lines.push("      #!/bin/bash");
  lines.push("      set -eux -o pipefail");
  lines.push('      # Kiro CLI (installs to ~/.local/bin, must run as user)');
  lines.push("      curl -fsSL https://cli.kiro.dev/install -o /tmp/kiro-install.sh && bash /tmp/kiro-install.sh || true");
  lines.push("      # Symlink kiro binaries to /usr/local/bin so they're in PATH for all sessions");
  lines.push("      for f in kiro-cli kiro-cli-chat kiro-cli-term; do");
  lines.push('        [ -f "$HOME/.local/bin/$f" ] && sudo ln -sf "$HOME/.local/bin/$f" /usr/local/bin/"$f" || true');
  lines.push("      done");
  lines.push('      # Claude Code — bypassPermissions');
  lines.push("      mkdir -p ~/.claude");
  lines.push(`      cat > ~/.claude/settings.json << 'EOF'`);
  lines.push('      {"permissions":{"defaultMode":"bypassPermissions","allow":["Bash","Edit","MultiEdit","Write","Read","Glob","Grep","WebFetch"]}}');
  lines.push("      EOF");
  lines.push('      # Codex — no approval, no sandbox');
  lines.push("      mkdir -p ~/.codex");
  lines.push(`      cat > ~/.codex/config.toml << 'EOF'`);
  lines.push('      approval_policy = "never"');
  lines.push('      sandbox_mode = "danger-full-access"');
  lines.push("      EOF");
  lines.push('      # Gemini — auto_edit (yolo only via CLI flag)');
  lines.push("      mkdir -p ~/.gemini");
  lines.push(`      cat > ~/.gemini/settings.json << 'EOF'`);
  lines.push('      {"security":{"auth":{"selectedType":"oauth-personal"}},"tools":{"approvalMode":"auto_edit"}}');
  lines.push("      EOF");
  lines.push('      # Credentials are injected at runtime via limactl copy (not via ~ mount)');
  lines.push("");

  return lines.join("\n") + "\n";
}

/**
 * Write template to a temp file and return its path.
 */
function writeTemplateFile(vmName: string, content: string): string {
  const dir = join(tmpdir(), "agentbox");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${vmName}.yaml`);
  writeFileSync(path, content, "utf-8");
  return path;
}

/**
 * Create a Lima VM from a ResolvedConfig.
 */
export function create(config: ResolvedConfig): number {
  const template = buildTemplate(config);
  const templatePath = writeTemplateFile(config.agent.vmName, template);

  log(`creating VM '${config.agent.vmName}'...`);
  return execInherit("limactl", [
    "create",
    "--name", config.agent.vmName,
    "--yes",
    templatePath,
  ]);
}

/**
 * Start an existing Lima VM.
 */
export function start(vmName: string): number {
  log(`starting VM '${vmName}'...`);
  return execInherit("limactl", ["start", vmName]);
}

/**
 * Stop a Lima VM.
 */
export function stop(vmName: string): number {
  return execInherit("limactl", ["stop", vmName]);
}

/**
 * Delete a Lima VM.
 */
export function remove(vmName: string): number {
  return execInherit("limactl", ["delete", "--force", vmName]);
}

/**
 * Build a shell command that sets env vars and execs the given command.
 * Wraps in `sh -c '...'` so that $HOME/$PATH are expanded by the remote shell.
 * (`limactl shell -- env K=V` does NOT go through a shell, so variable
 * references like $PATH are passed as literals and break PATH.)
 */
export function buildShellCmd(command: string[], env: Record<string, string>): string[] {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`);
  const escaped = command.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ");
  const parts = [
    `export PATH="$HOME/.local/bin:$PATH"`,
    ...exports,
    `exec ${escaped}`,
  ];
  return ["sh", "-c", parts.join(" && ")];
}

/**
 * Run an interactive shell command inside the VM.
 * Uses SSH with `-t` directly to ensure PTY allocation for TUI apps (Claude Code, etc.).
 * `limactl shell -- command` does NOT allocate a PTY, which causes TUI hangs.
 */
export function shellInteractive(
  vmName: string,
  workdir: string,
  command: string[],
  env: Record<string, string> = {},
): number {
  const sshConfig = join(homedir(), ".lima", vmName, "ssh.config");
  const sshHost = `lima-${vmName}`;

  // Build remote command: env + source persistent + cd + exec
  const exports = Object.entries(env).map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`);
  const escaped = command.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ");
  const parts = [
    `export PATH="$HOME/.local/bin:$PATH"`,
    ...exports,
    `. /etc/sandbox-persistent.sh 2>/dev/null || true`,
    `cd '${workdir.replace(/'/g, "'\\''")}'`,
    `exec ${escaped}`,
  ];
  const remoteCmd = parts.join(" && ");

  return execInherit("ssh", [
    "-t", "-t",
    "-F", sshConfig,
    sshHost,
    "--",
    remoteCmd,
  ]);
}

/**
 * Run a non-interactive shell command inside the VM and return exit code.
 */
export function shellNonInteractive(
  vmName: string,
  workdir: string,
  command: string[],
  env: Record<string, string> = {},
): number {
  return execInherit("limactl", [
    "shell",
    "--workdir", workdir,
    vmName,
    "--",
    ...buildShellCmd(command, env),
  ]);
}

/**
 * Run a command inside the VM and capture output.
 */
export function shellCapture(
  vmName: string,
  workdir: string,
  command: string[],
  env: Record<string, string> = {},
) {
  return execCapture("limactl", [
    "shell",
    "--workdir", workdir,
    vmName,
    "--",
    ...buildShellCmd(command, env),
  ]);
}

/**
 * Copy a file from host to VM.
 */
export function copyToVm(
  vmName: string,
  hostPath: string,
  vmPath: string,
): number {
  return execInherit("limactl", [
    "copy",
    hostPath,
    `${vmName}:${vmPath}`,
  ]);
}

/**
 * Poll SSH readiness by running `true` inside the VM.
 * Returns as soon as SSH is ready, or after timeout (does not throw).
 */
export async function waitForSsh(vmName: string, timeoutSec: number): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  const pollIntervalMs = 1000;

  while (Date.now() < deadline) {
    const result = execCapture("limactl", ["shell", vmName, "--", "true"]);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  log(`SSH readiness timeout after ${timeoutSec}s (continuing anyway)`);
}
