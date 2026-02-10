import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as lima from "../runtime/lima.js";
import { log } from "../utils/logger.js";

const PRE_PUSH_HOOK = `#!/bin/sh
echo "[agentbox] git push is blocked (readonly-remote mode)"
exit 1
`;

const GIT_WRAPPER = `#!/bin/sh
# agentbox readonly-remote: git wrapper (blocks remote writes)
REAL_GIT=$(PATH=$(echo "$PATH" | sed -e "s|$HOME/.local/bin:||g" -e "s|:$HOME/.local/bin||g" -e "s|^$HOME/.local/bin$||g") which git)

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
REAL_GH=$(PATH=$(echo "$PATH" | sed -e "s|$HOME/.local/bin:||g" -e "s|:$HOME/.local/bin||g" -e "s|^$HOME/.local/bin$||g") which gh)

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
      view|clone|list) exec "$REAL_GH" "$@" ;;
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
    # Allow only GET requests
    ALLOWED=true
    for arg in "$@"; do
      case "$arg" in
        -X)
          # Next arg will be checked
          ALLOWED=pending
          ;;
        -X*)
          # Combined form like -XPOST
          XVAL="\${arg#-X}"
          if [ "$XVAL" != "GET" ]; then ALLOWED=false; fi
          ;;
        --method)
          ALLOWED=pending
          ;;
        --method=*)
          MVAL="\${arg#--method=}"
          if [ "$MVAL" != "GET" ]; then ALLOWED=false; fi
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
 * Copy Kiro CLI credentials from macOS host to Linux VM.
 * macOS stores in ~/Library/Application Support/kiro-cli/data.sqlite3
 * Linux expects ~/.local/share/kiro-cli/data.sqlite3
 */
export function syncKiroCredentials(vmName: string, workspace: string): void {
  if (process.platform !== "darwin") return;

  const hostPath = join(homedir(), "Library", "Application Support", "kiro-cli", "data.sqlite3");
  if (!existsSync(hostPath)) return;

  log("syncing kiro credentials");
  // mkdir via shell (so $HOME expands correctly inside VM)
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "mkdir -p ~/.local/share/kiro-cli",
  ]);
  // limactl copy doesn't expand $HOME, so use a temp path then move via shell
  lima.copyToVm(vmName, hostPath, "/tmp/kiro-data.sqlite3");
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "mv /tmp/kiro-data.sqlite3 ~/.local/share/kiro-cli/data.sqlite3",
  ]);
}

/**
 * Copy specific credential files from host to VM.
 * Only the minimum required files are injected — NOT the entire home directory.
 */
export function injectCredentials(vmName: string, workspace: string): void {
  const home = homedir();

  const creds: { hostPath: string; vmDest: string }[] = [
    { hostPath: join(home, ".gitconfig"), vmDest: ".host-gitconfig" },
    { hostPath: join(home, ".netrc"), vmDest: ".netrc" },
    { hostPath: join(home, ".claude", ".credentials.json"), vmDest: ".claude/.credentials.json" },
    { hostPath: join(home, ".claude.json"), vmDest: ".claude.json" },
    { hostPath: join(home, ".codex", "auth.json"), vmDest: ".codex/auth.json" },
    { hostPath: join(home, ".config", "gh", "hosts.yml"), vmDest: ".config/gh/hosts.yml" },
    { hostPath: join(home, ".config", "gh", "config.yml"), vmDest: ".config/gh/config.yml" },
  ];
  for (const f of ["oauth_creds.json", "state.json", "google_account_id", "google_accounts.json", "installation_id"]) {
    creds.push({ hostPath: join(home, ".gemini", f), vmDest: `.gemini/${f}` });
  }

  const existing = creds.filter((c) => existsSync(c.hostPath));
  if (existing.length === 0) return;

  log("injecting credentials");

  // Stage files in VM temp dir
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "rm -rf /tmp/agentbox-creds && mkdir -p /tmp/agentbox-creds",
  ]);
  for (const c of existing) {
    const tmpName = c.vmDest.replace(/\//g, "__");
    lima.copyToVm(vmName, c.hostPath, `/tmp/agentbox-creds/${tmpName}`);
  }

  // Move all to home in one shell call
  const moveCommands = existing.map((c) => {
    const tmpName = c.vmDest.replace(/\//g, "__");
    return `mkdir -p "$(dirname "$HOME/${c.vmDest}")" && mv "/tmp/agentbox-creds/${tmpName}" "$HOME/${c.vmDest}"`;
  });
  moveCommands.push("rm -rf /tmp/agentbox-creds");
  lima.shellNonInteractive(vmName, workspace, ["sh", "-c", moveCommands.join(" && ")]);

  // gitconfig: include host config
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", '[ -f "$HOME/.host-gitconfig" ] && git config --global include.path "$HOME/.host-gitconfig" || true',
  ]);

  // gh auth setup-git
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "command -v gh >/dev/null 2>&1 && gh auth setup-git 2>/dev/null || true",
  ]);
}

/**
 * Write environment variables to /etc/sandbox-persistent.sh inside the VM.
 * This makes env vars available to shell sessions and scripts.
 */
export function injectEnvVars(
  vmName: string,
  workspace: string,
  env: Record<string, string>,
): void {
  const entries = Object.entries(env);
  if (entries.length === 0) {
    // Clear stale env file so removed keys don't persist
    lima.shellNonInteractive(vmName, workspace, [
      "sh", "-c",
      "sudo rm -f /etc/sandbox-persistent.sh",
    ]);
    return;
  }

  log("injecting environment variables");
  const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const args = entries
    .filter(([k]) => validKey.test(k))
    .map(([k, v]) => {
      const escaped = v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
      return `'export ${k}="${escaped}"'`;
    })
    .join(" ");
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c",
    `printf '%s\\n' ${args} | sudo tee /etc/sandbox-persistent.sh > /dev/null && sudo chmod 644 /etc/sandbox-persistent.sh`,
  ]);
}

/**
 * Install readonly-remote preset into a VM.
 * This blocks git push (via pre-push hook) and restricts gh CLI to read-only commands.
 */
export function installReadonlyRemote(vmName: string, workspace: string): void {
  log("installing readonly-remote preset");

  const writeFile = (vmPath: string, content: string, executable: boolean) => {
    const escapedContent = content.replace(/'/g, "'\\''");
    // Use $HOME instead of ~ so paths expand correctly inside single quotes
    const expandedPath = vmPath.replace(/^~\//, "$HOME/");
    const cmd = executable
      ? `mkdir -p "$(dirname "${expandedPath}")" && printf '%s' '${escapedContent}' > "${expandedPath}" && chmod +x "${expandedPath}"`
      : `mkdir -p "$(dirname "${expandedPath}")" && printf '%s' '${escapedContent}' > "${expandedPath}"`;
    lima.shellNonInteractive(vmName, workspace, ["sh", "-c", cmd]);
  };

  // 1. Set git hooks path + autoSetupRemote
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "git config --global core.hooksPath $HOME/.git-hooks",
  ]);
  lima.shellNonInteractive(vmName, workspace, [
    "git", "config", "--global", "push.autoSetupRemote", "true",
  ]);

  // 2. Install pre-push hook
  writeFile("~/.git-hooks/pre-push", PRE_PUSH_HOOK, true);

  // 3. Install git wrapper
  writeFile("~/.local/bin/git", GIT_WRAPPER, true);

  // 4. Install gh wrapper
  writeFile("~/.local/bin/gh", GH_WRAPPER, true);

  // 5. Setup git credential via gh
  lima.shellNonInteractive(vmName, workspace, [
    "sh", "-c", "command -v gh >/dev/null 2>&1 && gh auth setup-git 2>/dev/null || true",
  ]);
}
