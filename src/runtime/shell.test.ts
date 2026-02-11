import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/process.js", () => ({
  execInherit: vi.fn().mockReturnValue(0),
  execCapture: vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" }),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: vi.fn().mockReturnValue("/Users/testuser") };
});

import { buildShellCmd, shellNonInteractive, shellCapture, shellInteractive } from "./lima.js";
import { execInherit, execCapture } from "../utils/process.js";
import { homedir } from "node:os";

describe("buildShellCmd", () => {
  it("wraps command in sh -c", () => {
    const result = buildShellCmd(["echo", "hello"], {});
    expect(result[0]).toBe("sh");
    expect(result[1]).toBe("-c");
    expect(result[2]).toContain("exec 'echo' 'hello'");
  });

  it("uses $HOME and $PATH as shell variables (not literals)", () => {
    const result = buildShellCmd(["ls"], {});
    const script = result[2];
    expect(script).toContain('export PATH="$HOME/.local/bin:$PATH"');
    // These should be shell variable references, NOT hardcoded values
    expect(script).not.toContain("/home/");
    expect(script).not.toContain("/usr/bin");
  });

  it("exports env vars before exec", () => {
    const result = buildShellCmd(["cmd"], { FOO: "bar", BAZ: "qux" });
    const script = result[2];
    expect(script).toContain("export FOO='bar'");
    expect(script).toContain("export BAZ='qux'");
    // env exports come before exec
    const fooIdx = script.indexOf("export FOO=");
    const execIdx = script.indexOf("exec ");
    expect(fooIdx).toBeLessThan(execIdx);
  });

  it("escapes single quotes in env values", () => {
    const result = buildShellCmd(["cmd"], { VAR: "it's a test" });
    const script = result[2];
    expect(script).toContain("export VAR='it'\\''s a test'");
  });

  it("escapes single quotes in command args", () => {
    const result = buildShellCmd(["echo", "it's"], {});
    const script = result[2];
    expect(script).toContain("'it'\\''s'");
  });

  it("chains with && for proper error propagation", () => {
    const result = buildShellCmd(["cmd"], { A: "1" });
    const script = result[2];
    const parts = script.split(" && ");
    expect(parts.length).toBeGreaterThanOrEqual(3); // PATH export, env export, exec
  });
});

describe("shellNonInteractive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execInherit).mockReturnValue(0);
  });

  it("calls limactl shell with sh -c wrapper", () => {
    shellNonInteractive("test-vm", "/workspace", ["echo", "hi"], { FOO: "bar" });

    expect(execInherit).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(execInherit).mock.calls[0];
    expect(cmd).toBe("limactl");
    expect(args).toContain("shell");
    expect(args).toContain("test-vm");
    expect(args).toContain("--workdir");
    expect(args).toContain("/workspace");

    // Should use sh -c, not env
    const dashDashIdx = args.indexOf("--");
    const afterDash = args.slice(dashDashIdx + 1);
    expect(afterDash[0]).toBe("sh");
    expect(afterDash[1]).toBe("-c");
    expect(afterDash[2]).toContain("exec 'echo' 'hi'");
    expect(afterDash[2]).toContain("export FOO='bar'");
  });

  it("does NOT use env command (old broken pattern)", () => {
    shellNonInteractive("vm", "/ws", ["cmd"], {});

    const [, args] = vi.mocked(execInherit).mock.calls[0];
    expect(args).not.toContain("env");
  });

  it("returns exit code from execInherit", () => {
    vi.mocked(execInherit).mockReturnValue(42);
    const code = shellNonInteractive("vm", "/ws", ["cmd"], {});
    expect(code).toBe(42);
  });
});

describe("shellCapture", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execCapture).mockReturnValue({ status: 0, stdout: "out", stderr: "" });
  });

  it("calls limactl shell with sh -c wrapper", () => {
    shellCapture("test-vm", "/workspace", ["whoami"], { BAR: "baz" });

    expect(execCapture).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(execCapture).mock.calls[0];
    expect(cmd).toBe("limactl");

    const dashDashIdx = args.indexOf("--");
    const afterDash = args.slice(dashDashIdx + 1);
    expect(afterDash[0]).toBe("sh");
    expect(afterDash[1]).toBe("-c");
    expect(afterDash[2]).toContain("exec 'whoami'");
    expect(afterDash[2]).toContain("export BAR='baz'");
  });

  it("does NOT use env command (old broken pattern)", () => {
    shellCapture("vm", "/ws", ["cmd"], {});

    const [, args] = vi.mocked(execCapture).mock.calls[0];
    expect(args).not.toContain("env");
  });

  it("returns result from execCapture", () => {
    vi.mocked(execCapture).mockReturnValue({ status: 0, stdout: "hello", stderr: "" });
    const result = shellCapture("vm", "/ws", ["echo"], {});
    expect(result.stdout).toBe("hello");
  });
});

describe("shellInteractive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(execInherit).mockReturnValue(0);
    vi.mocked(homedir).mockReturnValue("/Users/testuser");
  });

  it("uses ssh directly with -t -t for PTY", () => {
    shellInteractive("test-vm", "/workspace", ["claude"], { TOKEN: "abc" });

    expect(execInherit).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(execInherit).mock.calls[0];
    expect(cmd).toBe("ssh");
    expect(args).toContain("-t");
    expect(args).toContain("-F");
    expect(args).toContain("/Users/testuser/.lima/test-vm/ssh.config");
    expect(args).toContain("lima-test-vm");
  });

  it("builds shell command with variable expansion", () => {
    shellInteractive("vm", "/ws", ["bash"], { FOO: "bar" });

    const [, args] = vi.mocked(execInherit).mock.calls[0];
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(remoteCmd).toContain("export FOO='bar'");
    expect(remoteCmd).toContain("cd '/ws'");
    expect(remoteCmd).toContain("exec 'bash'");
  });

  it("sources sandbox-persistent.sh", () => {
    shellInteractive("vm", "/ws", ["cmd"], {});

    const [, args] = vi.mocked(execInherit).mock.calls[0];
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain(". /etc/sandbox-persistent.sh 2>/dev/null || true");
  });

  it("does NOT use limactl (uses ssh directly)", () => {
    shellInteractive("vm", "/ws", ["cmd"], {});

    const [cmd] = vi.mocked(execInherit).mock.calls[0];
    expect(cmd).toBe("ssh");
    expect(cmd).not.toBe("limactl");
  });
});
