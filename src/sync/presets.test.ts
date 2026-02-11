import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../runtime/lima.js", () => ({
  shellNonInteractive: vi.fn().mockReturnValue(0),
  copyToVm: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: vi.fn().mockReturnValue("/Users/testuser") };
});

import { injectEnvVars, injectCredentials, installReadonlyRemote } from "./presets.js";
import * as lima from "../runtime/lima.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

describe("injectEnvVars", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lima.shellNonInteractive).mockReturnValue(0);
  });

  it("clears stale env file when env is empty", () => {
    injectEnvVars("vm", "/ws", {});

    const [, , cmd] = vi.mocked(lima.shellNonInteractive).mock.calls[0];
    expect(cmd).toContain("sh");
    expect(cmd[2]).toContain("sudo rm -f /etc/sandbox-persistent.sh");
  });

  it("writes export statements for env vars", () => {
    injectEnvVars("vm", "/ws", { FOO: "bar", BAZ: "qux" });

    const [, , cmd] = vi.mocked(lima.shellNonInteractive).mock.calls[0];
    const script = cmd[2];
    expect(script).toContain("export FOO=");
    expect(script).toContain("export BAZ=");
    expect(script).toContain("sudo tee /etc/sandbox-persistent.sh");
  });

  it("escapes double quotes in values", () => {
    injectEnvVars("vm", "/ws", { VAR: 'say "hello"' });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain('\\"hello\\"');
  });

  it("escapes dollar signs in values", () => {
    injectEnvVars("vm", "/ws", { VAR: "price is $100" });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain("\\$100");
  });

  it("escapes backticks in values", () => {
    injectEnvVars("vm", "/ws", { VAR: "cmd `whoami`" });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain("\\`whoami\\`");
  });

  it("escapes single quotes in values", () => {
    injectEnvVars("vm", "/ws", { VAR: "it's a test" });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain("'\\''");
  });

  it("escapes backslashes in values", () => {
    injectEnvVars("vm", "/ws", { VAR: "path\\to\\file" });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain("\\\\");
  });

  it("rejects keys with invalid characters", () => {
    injectEnvVars("vm", "/ws", { "GOOD_KEY": "ok", "bad-key": "no", "123start": "no" });

    const script = vi.mocked(lima.shellNonInteractive).mock.calls[0][2][2];
    expect(script).toContain("GOOD_KEY");
    expect(script).not.toContain("bad-key");
    expect(script).not.toContain("123start");
  });
});

describe("injectCredentials", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lima.shellNonInteractive).mockReturnValue(0);
    vi.mocked(homedir).mockReturnValue("/Users/testuser");
  });

  it("does nothing when no credential files exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    injectCredentials("vm", "/ws");

    expect(lima.copyToVm).not.toHaveBeenCalled();
  });

  it("copies existing credential files to VM", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p) === "/Users/testuser/.gitconfig" ||
        String(p) === "/Users/testuser/.netrc";
    });
    injectCredentials("vm", "/ws");

    // Should call copyToVm for each existing file
    expect(lima.copyToVm).toHaveBeenCalledTimes(2);
  });

  it("stages files in temp dir then moves to home", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p) === "/Users/testuser/.gitconfig";
    });
    injectCredentials("vm", "/ws");

    // First call: create temp dir
    const firstCall = vi.mocked(lima.shellNonInteractive).mock.calls[0];
    expect(firstCall[2][2]).toContain("/tmp/agentbox-creds");

    // Copy to temp
    expect(lima.copyToVm).toHaveBeenCalledWith(
      "vm",
      "/Users/testuser/.gitconfig",
      expect.stringContaining("/tmp/agentbox-creds/"),
    );

    // Move from temp to home
    const moveCall = vi.mocked(lima.shellNonInteractive).mock.calls.find(
      (c) => c[2][2]?.includes("$HOME/"),
    );
    expect(moveCall).toBeDefined();
  });

  it("sets up gitconfig include for host config", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p) === "/Users/testuser/.gitconfig";
    });
    injectCredentials("vm", "/ws");

    const gitConfigCall = vi.mocked(lima.shellNonInteractive).mock.calls.find(
      (c) => c[2][2]?.includes("git config --global include.path"),
    );
    expect(gitConfigCall).toBeDefined();
  });
});

describe("installReadonlyRemote", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lima.shellNonInteractive).mockReturnValue(0);
  });

  it("sets git hooks path", () => {
    installReadonlyRemote("vm", "/ws");

    const hooksCall = vi.mocked(lima.shellNonInteractive).mock.calls.find(
      (c) => c[2][2]?.includes("core.hooksPath"),
    );
    expect(hooksCall).toBeDefined();
  });

  it("installs pre-push hook", () => {
    installReadonlyRemote("vm", "/ws");

    const calls = vi.mocked(lima.shellNonInteractive).mock.calls;
    const hookCall = calls.find(
      (c) => c[2][2]?.includes("git-hooks/pre-push"),
    );
    expect(hookCall).toBeDefined();
    expect(hookCall![2][2]).toContain("git push is blocked");
  });

  it("installs git wrapper in ~/.local/bin", () => {
    installReadonlyRemote("vm", "/ws");

    const calls = vi.mocked(lima.shellNonInteractive).mock.calls;
    const gitWrapperCall = calls.find(
      (c) => c[2][2]?.includes(".local/bin/git") && c[2][2]?.includes("chmod +x"),
    );
    expect(gitWrapperCall).toBeDefined();
    // Content is single-quote escaped for sh -c, so check for the readable part
    expect(gitWrapperCall![2][2]).toContain("readonly-remote: git wrapper");
  });

  it("installs gh wrapper in ~/.local/bin", () => {
    installReadonlyRemote("vm", "/ws");

    const calls = vi.mocked(lima.shellNonInteractive).mock.calls;
    const ghWrapperCall = calls.find(
      (c) => c[2][2]?.includes(".local/bin/gh") && c[2][2]?.includes("chmod +x"),
    );
    expect(ghWrapperCall).toBeDefined();
    expect(ghWrapperCall![2][2]).toContain("readonly-remote");
  });

  it("sets push.autoSetupRemote", () => {
    installReadonlyRemote("vm", "/ws");

    const calls = vi.mocked(lima.shellNonInteractive).mock.calls;
    const autoSetupCall = calls.find(
      (c) => c[2].includes("push.autoSetupRemote"),
    );
    expect(autoSetupCall).toBeDefined();
  });
});
