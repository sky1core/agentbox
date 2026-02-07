import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execWithStdinPipe, execCaptureInSandbox, execNonInteractive } from "../docker/sandbox.js";
import { log } from "../utils/logger.js";
import { expandHome } from "./files.js";

const PRE_PUSH_HOOK = `#!/bin/sh
echo "[agentbox] git push is blocked (readonly-remote mode)"
exit 1
`;

const GIT_WRAPPER = `#!/bin/sh
# agentbox readonly-remote: git wrapper (blocks remote writes)
REAL_GIT=$(PATH=$(echo "$PATH" | sed "s|$HOME/.local/bin:||g") which git)

if [ -z "$REAL_GIT" ]; then
  echo "[agentbox] git: real binary not found"
  exit 1
fi

# Find the git subcommand (first non-option token). Keep original "$@" intact.
SUB=""
SKIP=0
for arg in "$@"; do
  if [ "$SKIP" -gt 0 ]; then
    SKIP=$((SKIP-1))
    continue
  fi
  case "$arg" in
    -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)
      SKIP=1
      ;;
    --)
      ;;
    -*)
      ;;
    *)
      SUB="$arg"
      break
      ;;
  esac
done

case "$SUB" in
  push|send-pack|receive-pack)
    echo "[agentbox] git $SUB is blocked (readonly-remote mode)"
    exit 1
    ;;
esac

exec "$REAL_GIT" "$@"
`;

const GH_WRAPPER = `#!/bin/sh
# agentbox readonly-remote: gh wrapper (whitelist mode)
REAL_GH=$(PATH=$(echo "$PATH" | sed "s|$HOME/.local/bin:||g") which gh)

if [ -z "$REAL_GH" ]; then
  echo "[agentbox] gh: real binary not found"
  exit 1
fi

CMD="\${1:-}"
SUB="\${2:-}"

case "$CMD" in
  pr)
    case "$SUB" in
      create|view|list|checks|diff|status) exec "$REAL_GH" "$@" ;;
      *) echo "[agentbox] gh $CMD $SUB is blocked (readonly-remote mode)"; exit 1 ;;
    esac
    ;;
  repo)
    case "$SUB" in
      view|clone) exec "$REAL_GH" "$@" ;;
      *) echo "[agentbox] gh $CMD $SUB is blocked (readonly-remote mode)"; exit 1 ;;
    esac
    ;;
  issue)
    case "$SUB" in
      list|view|status|create|comment|edit|close|reopen) exec "$REAL_GH" "$@" ;;
      *) echo "[agentbox] gh $CMD $SUB is blocked (readonly-remote mode)"; exit 1 ;;
    esac
    ;;
  api)
    # Allow only GET requests (no -X or -X GET)
    ALLOWED=true
    for arg in "$@"; do
      case "$arg" in
        -X)
          # Next arg will be checked
          ALLOWED=pending
          ;;
        *)
          if [ "$ALLOWED" = "pending" ]; then
            if [ "$arg" = "GET" ]; then
              ALLOWED=true
            else
              ALLOWED=false
            fi
          fi
          ;;
      esac
    done
    if [ "$ALLOWED" = "true" ]; then
      exec "$REAL_GH" "$@"
    else
      echo "[agentbox] gh api with non-GET method is blocked (readonly-remote mode)"
      exit 1
    fi
    ;;
  project)
    case "$SUB" in
      delete) echo "[agentbox] gh $CMD $SUB is blocked (readonly-remote mode)"; exit 1 ;;
      *) exec "$REAL_GH" "$@" ;;
    esac
    ;;
  auth|config) exec "$REAL_GH" "$@" ;;
  help|version|--help|--version|-h) exec "$REAL_GH" "$@" ;;
  search) exec "$REAL_GH" "$@" ;;
  "") exec "$REAL_GH" "$@" ;;
  *) echo "[agentbox] gh $CMD is blocked (readonly-remote mode)"; exit 1 ;;
esac
`;

/**
 * Write Claude Code OAuth credentials and mark onboarding complete.
 * Without hasCompletedOnboarding in ~/.claude.json, interactive mode
 * still shows login prompt even with CLAUDE_CODE_OAUTH_TOKEN set.
 * See: https://github.com/anthropics/claude-code/issues/8938
 */
export function injectClaudeCredentials(
  sandboxName: string,
  env: Record<string, string>,
): void {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return;

  log("injecting claude credentials");

  // 1. Write credentials file
  const creds = JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: "",
      expiresAt: 9999999999999,
      scopes: ["user:inference", "user:profile"],
    },
  });
  execWithStdinPipe(
    sandboxName,
    `cat > /home/agent/.claude/.credentials.json`,
    creds,
  );

  // 2. Set hasCompletedOnboarding in ~/.claude.json to skip onboarding
  execWithStdinPipe(
    sandboxName,
    `python3 -c "
import json, os
p = '/home/agent/.claude.json'
d = {}
if os.path.exists(p):
    with open(p) as f: d = json.load(f)
d['hasCompletedOnboarding'] = True
with open(p, 'w') as f: json.dump(d, f)
"`,
    "",
  );
}


/**
 * Inject kiro CLI credentials (SQLite DB) from host into sandbox.
 * kiro stores auth tokens in a SQLite DB:
 *   macOS: ~/Library/Application Support/kiro-cli/data.sqlite3
 *   Linux: ~/.local/share/kiro-cli/data.sqlite3
 * Sandbox (Linux) expects: ~/.local/share/kiro-cli/data.sqlite3
 */
export function injectKiroCredentials(sandboxName: string): void {
  const home = homedir();
  const hostPath =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "kiro-cli", "data.sqlite3")
      : join(home, ".local", "share", "kiro-cli", "data.sqlite3");

  if (!existsSync(hostPath)) {
    log("skip kiro credential injection (data.sqlite3 not found on host)");
    return;
  }

  log("injecting kiro credentials");
  const content = readFileSync(hostPath);
  execWithStdinPipe(
    sandboxName,
    `mkdir -p ~/.local/share/kiro-cli && cat > ~/.local/share/kiro-cli/data.sqlite3`,
    content,
  );
}

/**
 * Inject Gemini CLI credentials from host into sandbox.
 * Gemini uses OAuth personal auth with files in ~/.gemini/:
 *   oauth_creds.json, settings.json, google_account_id, google_accounts.json
 */
export function injectGeminiCredentials(sandboxName: string): void {
  const home = homedir();
  const geminiDir = join(home, ".gemini");
  const oauthPath = join(geminiDir, "oauth_creds.json");

  if (!existsSync(oauthPath)) {
    log("skip gemini credential injection (oauth_creds.json not found on host)");
    return;
  }

  log("injecting gemini credentials");

  const files = ["oauth_creds.json", "settings.json", "google_account_id", "google_accounts.json"];
  for (const file of files) {
    const hostFile = join(geminiDir, file);
    if (!existsSync(hostFile)) continue;
    const content = readFileSync(hostFile);
    execWithStdinPipe(
      sandboxName,
      `cat > ~/.gemini/${file}`,
      content,
    );
  }
}

/**
 * Inject Codex CLI credentials/config from host into sandbox.
 *
 * Default files (if not overridden by config):
 * - ~/.codex/auth.json
 * - ~/.codex/config.toml
 *
 * NOTE: Files are copied to the same path under /home/agent inside the sandbox.
 */
export function injectCodexCredentials(sandboxName: string, files: string[]): void {
  if (!files || files.length === 0) return;

  let didAny = false;
  for (const raw of files) {
    if (!raw.startsWith("~/")) {
      log(`skip codex credential file (only ~/ paths supported): ${raw}`);
      continue;
    }
    const hostPath = expandHome(raw);
    if (!existsSync(hostPath)) continue;

    if (!didAny) {
      log("injecting codex credentials");
      didAny = true;
    }

    const content = readFileSync(hostPath);
    const sandboxPath = `/home/agent/${raw.slice(2)}`;
    execWithStdinPipe(
      sandboxName,
      `mkdir -p "$(dirname "${sandboxPath}")" && cat > "${sandboxPath}" && chmod 600 "${sandboxPath}"`,
      content,
    );
  }
}

const CODEX_CONFIG_TOML = `# Codex configuration for Docker sandbox
# approval-free + full network access (sandbox is the isolation boundary)
approval_policy = "never"
sandbox_mode = "danger-full-access"
`;

/**
 * Ensure ~/.codex/config.toml exists with sandbox_mode = "danger-full-access".
 * Without this, Codex applies its own internal sandboxing (landlock/seccomp)
 * which blocks network access — causing all curl/git/gh calls to fail with
 * "socket: operation not permitted" even though the Docker sandbox proxy works fine.
 *
 * The Docker sandbox image ships this file, but it can be lost (e.g. agent
 * accidentally deletes it). This function restores it if missing.
 */
export function ensureCodexConfig(sandboxName: string): void {
  const check = execCaptureInSandbox(sandboxName, "/tmp", [
    "sh", "-c", 'test -f ~/.codex/config.toml && echo yes || echo no',
  ]);
  if ((check.stdout ?? "").trim() === "yes") return;

  log("restoring ~/.codex/config.toml (sandbox_mode = danger-full-access)");
  execWithStdinPipe(
    sandboxName,
    `mkdir -p ~/.codex && cat > ~/.codex/config.toml`,
    CODEX_CONFIG_TOML,
  );
}

/**
 * Ensure host.docker.internal resolves inside the sandbox by pinning it in /etc/hosts.
 *
 * Docker Sandbox routes all outbound traffic through an HTTP proxy at
 * host.docker.internal:3128. When the sandbox's internal DNS is flaky (known
 * Docker Desktop issue), the hostname stops resolving and ALL network calls
 * (curl/git/gh) fail.
 *
 * This function unconditionally pins host.docker.internal in /etc/hosts so that
 * DNS flakiness never breaks networking. Unlike probing the proxy first (which
 * itself fails when DNS is broken or the proxy is still starting), we just write
 * the entry and let the proxy catch up.
 */
export function ensureHostDockerInternal(sandboxName: string, workspace: string): void {
  // Skip if /etc/hosts already has the entry
  const hostsCheck = execCaptureInSandbox(sandboxName, workspace, [
    "sh", "-c", 'grep -q "host\\.docker\\.internal" /etc/hosts 2>/dev/null && echo yes || echo no',
  ]);
  if ((hostsCheck.stdout ?? "").trim() === "yes") return;

  // Determine IP: DNS → resolv.conf derivation → Docker Desktop default
  const ip = resolveGatewayIp(sandboxName, workspace);

  log(`pinning host.docker.internal -> ${ip} (/etc/hosts)`);
  const py = [
    "import pathlib",
    "p=pathlib.Path('/etc/hosts')",
    "lines=p.read_text().splitlines() if p.exists() else []",
    "lines=[l for l in lines if 'host.docker.internal' not in l]",
    `lines.append('${ip} host.docker.internal')`,
    "p.write_text('\\n'.join(lines)+'\\n')",
  ].join("\n");
  const code = execNonInteractive(sandboxName, workspace, ["sudo", "python3", "-c", py]);
  if (code !== 0) log("failed to patch /etc/hosts for host.docker.internal");
}

function resolveGatewayIp(sandboxName: string, workspace: string): string {
  // 1. DNS resolution (works when DNS is healthy)
  const getent = execCaptureInSandbox(sandboxName, workspace, [
    "sh", "-c", "getent hosts host.docker.internal | awk '{print $1}' | head -n 1",
  ]);
  const dnsIp = (getent.stdout ?? "").trim();
  if (dnsIp && /^\d+\.\d+\.\d+\.\d+$/.test(dnsIp)) return dnsIp;

  // 2. Derive from resolv.conf nameserver (x.y.z.w → x.y.z.254)
  const derived = execCaptureInSandbox(sandboxName, workspace, [
    "sh", "-c", `awk '/^nameserver/{split($2,a,"."); print a[1]"."a[2]"."a[3]".254"; exit}' /etc/resolv.conf`,
  ]);
  const derivedIp = (derived.stdout ?? "").trim();
  if (derivedIp && /^\d+\.\d+\.\d+\.254$/.test(derivedIp)) return derivedIp;

  // 3. Docker Desktop default gateway
  return "192.168.65.254";
}

/**
 * Verify that outbound network works through the proxy inside the sandbox.
 * Returns true if an external HTTPS request succeeds.
 */
export function verifyProxyConnectivity(sandboxName: string, workspace: string): boolean {
  const result = execCaptureInSandbox(sandboxName, workspace, [
    "sh", "-c", "curl -s -o /dev/null -w '%{http_code}' --max-time 3 https://example.com 2>/dev/null || echo 000",
  ]);
  const code = (result.stdout ?? "").trim();
  return /^[23]\d\d$/.test(code);
}

/**
 * Inject host's GitHub token into sandbox /run/secrets/gh_token.
 * The sandbox image has a git-credential-gh-token helper that reads from this path.
 * Since /run/secrets is tmpfs, this must be done on every sandbox start.
 */
export function injectGhToken(sandboxName: string): void {
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf-8" });
  if (result.error) {
    log("skip gh token injection (gh not installed on host)");
    return;
  }
  const token = (result.stdout ?? "").trim();
  if (result.status !== 0 || !token) {
    log("skip gh token injection (gh not authenticated on host)");
    return;
  }

  log("injecting gh token");
  // 1. /run/secrets/gh_token for git-credential-gh-token helper
  execWithStdinPipe(
    sandboxName,
    `sudo sh -c 'cat > /run/secrets/gh_token && chmod 600 /run/secrets/gh_token && chown agent:agent /run/secrets/gh_token'`,
    token,
  );
  // 2. gh auth login for gh CLI
  execWithStdinPipe(
    sandboxName,
    `gh auth login --with-token`,
    token,
  );
}

/**
 * Install readonly-remote preset into a sandbox.
 * This blocks git push (via pre-push hook) and restricts gh CLI to read-only commands.
 */
export function installReadonlyRemote(sandboxName: string): void {
  log("installing readonly-remote preset");

  // 1. Set git hooks path + autoSetupRemote so git push works without --set-upstream
  execWithStdinPipe(
    sandboxName,
    `git config --global core.hooksPath ~/.git-hooks && git config --global push.autoSetupRemote true`,
    "",
  );

  // 2. Install pre-push hook
  execWithStdinPipe(
    sandboxName,
    `mkdir -p ~/.git-hooks && cat > ~/.git-hooks/pre-push && chmod +x ~/.git-hooks/pre-push`,
    PRE_PUSH_HOOK,
  );

  // 3. Install git wrapper (prevents bypassing hooks with --no-verify)
  execWithStdinPipe(
    sandboxName,
    `mkdir -p ~/.local/bin && cat > ~/.local/bin/git && chmod +x ~/.local/bin/git`,
    GIT_WRAPPER,
  );

  // 4. Install gh wrapper
  execWithStdinPipe(
    sandboxName,
    `mkdir -p ~/.local/bin && cat > ~/.local/bin/gh && chmod +x ~/.local/bin/gh`,
    GH_WRAPPER,
  );

  // 5. Setup git credential via gh (so pre-push hook runs before credential errors)
  execWithStdinPipe(
    sandboxName,
    `command -v gh >/dev/null 2>&1 && gh auth setup-git 2>/dev/null || true`,
    "",
  );
}
