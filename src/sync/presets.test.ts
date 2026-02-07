import { describe, it, expect, vi, beforeEach } from "vitest";
import { installReadonlyRemote, ensureHostDockerInternal, verifyProxyConnectivity } from "./presets.js";

vi.mock("../docker/sandbox.js", () => ({
  execWithStdinPipe: vi.fn(),
  execCaptureInSandbox: vi.fn(),
  execNonInteractive: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

import { execWithStdinPipe } from "../docker/sandbox.js";
import { execCaptureInSandbox, execNonInteractive } from "../docker/sandbox.js";

const mockExec = vi.mocked(execWithStdinPipe);
const mockCapture = vi.mocked(execCaptureInSandbox);
const mockNonInteractive = vi.mocked(execNonInteractive);

beforeEach(() => {
  mockExec.mockReset();
  mockCapture.mockReset();
  mockNonInteractive.mockReset();
});

describe("installReadonlyRemote", () => {
  it("makes exactly 5 calls to execWithStdinPipe", () => {
    installReadonlyRemote("codex-myproj");
    expect(mockExec).toHaveBeenCalledTimes(5);
  });

  it("runs gh auth setup-git after installing gh wrapper", () => {
    installReadonlyRemote("codex-myproj");
    const [name, cmd] = mockExec.mock.calls[4];
    expect(name).toBe("codex-myproj");
    expect(cmd).toContain("gh auth setup-git");
  });

  it("sets git hooks path via git config", () => {
    installReadonlyRemote("codex-myproj");
    const [name, cmd] = mockExec.mock.calls[0];
    expect(name).toBe("codex-myproj");
    expect(cmd).toContain("git config --global core.hooksPath");
  });

  it("installs pre-push hook that blocks git push", () => {
    installReadonlyRemote("codex-myproj");
    const [name, cmd, content] = mockExec.mock.calls[1];
    expect(name).toBe("codex-myproj");
    expect(cmd).toContain("pre-push");
    expect(cmd).toContain("chmod +x");
    expect(String(content)).toContain("exit 1");
    expect(String(content)).toContain("git push is blocked");
  });

  it("installs gh wrapper with whitelist approach", () => {
    installReadonlyRemote("codex-myproj");
    const [name, cmd, content] = mockExec.mock.calls[3];
    expect(name).toBe("codex-myproj");
    expect(cmd).toContain("~/.local/bin/gh");
    expect(cmd).toContain("chmod +x");
    const script = String(content);
    // Whitelist commands should be present
    expect(script).toContain("pr)");
    expect(script).toContain("create|view|list|checks|diff|status");
    expect(script).toContain("repo)");
    expect(script).toContain("view|clone");
    expect(script).toContain("issue)");
    expect(script).toContain("list|view|status");
    expect(script).toContain("api)");
    expect(script).toContain("auth|config");
    expect(script).toContain("search");
    // Blocked commands should show message
    expect(script).toContain("is blocked (readonly-remote mode)");
    // Should find real gh by removing ~/.local/bin from PATH
    expect(script).toContain("REAL_GH=");
  });

  it("gh wrapper blocks non-GET API methods", () => {
    installReadonlyRemote("codex-myproj");
    const script = String(mockExec.mock.calls[3][2]);
    expect(script).toContain("non-GET method is blocked");
  });

  it("installs git wrapper that blocks git push", () => {
    installReadonlyRemote("codex-myproj");
    const [name, cmd, content] = mockExec.mock.calls[2];
    expect(name).toBe("codex-myproj");
    expect(cmd).toContain("~/.local/bin/git");
    expect(cmd).toContain("chmod +x");
    const script = String(content);
    expect(script).toContain("git $SUB is blocked");
    expect(script).toContain("push|send-pack|receive-pack");
  });

  it("uses the provided sandbox name for all calls", () => {
    installReadonlyRemote("claude-test-project");
    for (const call of mockExec.mock.calls) {
      expect(call[0]).toBe("claude-test-project");
    }
  });
});

describe("ensureHostDockerInternal", () => {
  it("does nothing if /etc/hosts already has the entry", () => {
    mockCapture.mockReturnValueOnce({ stdout: "yes\n", stderr: "", status: 0 });
    ensureHostDockerInternal("codex-myproj", "/workspace");
    expect(mockNonInteractive).not.toHaveBeenCalled();
  });

  it("patches /etc/hosts using DNS-resolved IP when available", () => {
    // 1) /etc/hosts check → no entry
    mockCapture.mockReturnValueOnce({ stdout: "no\n", stderr: "", status: 0 });
    // 2) getent → DNS resolves
    mockCapture.mockReturnValueOnce({ stdout: "192.168.65.254\n", stderr: "", status: 0 });
    mockNonInteractive.mockReturnValueOnce(0);

    ensureHostDockerInternal("codex-myproj", "/workspace");
    expect(mockNonInteractive).toHaveBeenCalledTimes(1);
    expect(mockNonInteractive.mock.calls[0][0]).toBe("codex-myproj");
    expect(mockNonInteractive.mock.calls[0][2][0]).toBe("sudo");
  });

  it("derives IP from resolv.conf when DNS is broken", () => {
    // 1) /etc/hosts check → no entry
    mockCapture.mockReturnValueOnce({ stdout: "no\n", stderr: "", status: 0 });
    // 2) getent → DNS fails
    mockCapture.mockReturnValueOnce({ stdout: "", stderr: "", status: 2 });
    // 3) resolv.conf derivation
    mockCapture.mockReturnValueOnce({ stdout: "192.168.65.254\n", stderr: "", status: 0 });
    mockNonInteractive.mockReturnValueOnce(0);

    ensureHostDockerInternal("codex-myproj", "/workspace");
    // Should patch unconditionally (no proxy probe)
    expect(mockNonInteractive).toHaveBeenCalledTimes(1);
  });

  it("falls back to default gateway when all discovery fails", () => {
    // 1) /etc/hosts check → no entry
    mockCapture.mockReturnValueOnce({ stdout: "no\n", stderr: "", status: 0 });
    // 2) getent → fails
    mockCapture.mockReturnValueOnce({ stdout: "", stderr: "", status: 2 });
    // 3) resolv.conf → fails
    mockCapture.mockReturnValueOnce({ stdout: "", stderr: "", status: 1 });
    mockNonInteractive.mockReturnValueOnce(0);

    ensureHostDockerInternal("codex-myproj", "/workspace");
    // Should still patch with default 192.168.65.254
    expect(mockNonInteractive).toHaveBeenCalledTimes(1);
    const pyScript = mockNonInteractive.mock.calls[0][2][3]; // ["sudo","python3","-c",<script>]
    expect(pyScript).toContain("192.168.65.254");
  });
});

describe("verifyProxyConnectivity", () => {
  it("returns true when curl gets 200", () => {
    mockCapture.mockReturnValueOnce({ stdout: "200", stderr: "", status: 0 });
    expect(verifyProxyConnectivity("codex-myproj", "/workspace")).toBe(true);
  });

  it("returns true for redirect status codes", () => {
    mockCapture.mockReturnValueOnce({ stdout: "301", stderr: "", status: 0 });
    expect(verifyProxyConnectivity("codex-myproj", "/workspace")).toBe(true);
  });

  it("returns false when curl fails", () => {
    mockCapture.mockReturnValueOnce({ stdout: "000", stderr: "", status: 0 });
    expect(verifyProxyConnectivity("codex-myproj", "/workspace")).toBe(false);
  });

  it("returns false on empty output", () => {
    mockCapture.mockReturnValueOnce({ stdout: "", stderr: "", status: 1 });
    expect(verifyProxyConnectivity("codex-myproj", "/workspace")).toBe(false);
  });
});
