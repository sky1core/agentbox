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

import { runBootstrap } from "./bootstrap.js";
import * as lima from "../runtime/lima.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

describe("runBootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lima.shellNonInteractive).mockReturnValue(0);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(homedir).mockReturnValue("/Users/testuser");
  });

  it("does nothing when scripts array is empty", () => {
    runBootstrap("onCreate", "vm", "/workspace", [], {});
    expect(lima.shellNonInteractive).not.toHaveBeenCalled();
  });

  it("runs workspace-relative script via bash interpreter", () => {
    runBootstrap("onCreate", "vm", "/workspace", ["./scripts/setup.sh"], {});

    expect(lima.shellNonInteractive).toHaveBeenCalledWith(
      "vm",
      "/workspace",
      ["bash", "-euo", "pipefail", "/workspace/scripts/setup.sh"],
      {},
    );
  });

  it("runs workspace-relative script without ./ prefix", () => {
    runBootstrap("onStart", "vm", "/workspace", ["scripts/start.sh"], {});

    expect(lima.shellNonInteractive).toHaveBeenCalledWith(
      "vm",
      "/workspace",
      ["bash", "-euo", "pipefail", "/workspace/scripts/start.sh"],
      {},
    );
  });

  it("copies host ~ script to VM before running", () => {
    runBootstrap("onCreate", "vm", "/workspace", ["~/my-script.sh"], {});

    // Should copy from host to VM temp dir
    expect(lima.copyToVm).toHaveBeenCalledWith(
      "vm",
      "/Users/testuser/my-script.sh",
      expect.stringContaining("/tmp/agentbox-bootstrap/my-script.sh"),
    );
    // Should run via bash
    expect(lima.shellNonInteractive).toHaveBeenCalledWith(
      "vm",
      "/workspace",
      ["bash", "-euo", "pipefail", expect.stringContaining("/tmp/agentbox-bootstrap/my-script.sh")],
      {},
    );
  });

  it("throws when workspace script does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() =>
      runBootstrap("onCreate", "vm", "/workspace", ["./missing.sh"], {}),
    ).toThrow("bootstrap script not found");
  });

  it("throws when script execution fails (non-zero exit)", () => {
    vi.mocked(lima.shellNonInteractive).mockReturnValue(1);

    expect(() =>
      runBootstrap("onCreate", "vm", "/workspace", ["./setup.sh"], {}),
    ).toThrow("bootstrap onCreate failed (exit=1)");
  });

  it("runs multiple scripts in order", () => {
    runBootstrap("onStart", "vm", "/workspace", ["./a.sh", "./b.sh"], {});

    const calls = vi.mocked(lima.shellNonInteractive).mock.calls;
    // Should run a.sh then b.sh
    expect(calls[0][2]).toContain("bash");
    expect(calls[0][2][3]).toContain("/workspace/a.sh");
    expect(calls[1][2][3]).toContain("/workspace/b.sh");
  });

  it("passes env to shellNonInteractive", () => {
    const env = { FOO: "bar" };
    runBootstrap("onCreate", "vm", "/workspace", ["./setup.sh"], env);

    expect(lima.shellNonInteractive).toHaveBeenCalledWith(
      "vm",
      "/workspace",
      expect.any(Array),
      env,
    );
  });
});
