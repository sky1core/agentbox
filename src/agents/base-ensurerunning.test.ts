import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../runtime/lima.js", () => ({
  getState: vi.fn(),
  create: vi.fn().mockReturnValue(0),
  start: vi.fn().mockReturnValue(0),
  stop: vi.fn().mockReturnValue(0),
  remove: vi.fn().mockReturnValue(0),
  waitForSsh: vi.fn().mockResolvedValue(undefined),
  shellNonInteractive: vi.fn().mockReturnValue(0),
  copyToVm: vi.fn(),
}));

vi.mock("../sync/presets.js", () => ({
  injectCredentials: vi.fn(),
  syncKiroCredentials: vi.fn(),
  injectEnvVars: vi.fn(),
  installReadonlyRemote: vi.fn(),
}));

vi.mock("../sync/bootstrap.js", () => ({
  runBootstrap: vi.fn(),
}));

import { ensureRunning } from "./base.js";
import * as lima from "../runtime/lima.js";
import { injectCredentials, injectEnvVars, installReadonlyRemote } from "../sync/presets.js";
import { runBootstrap } from "../sync/bootstrap.js";
import type { ResolvedConfig } from "../config/schema.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    workspace: "/workspace",
    remoteWrite: false,
    vm: { cpus: 4, memory: "8GiB", disk: "20GiB" },
    mounts: [],
    startupWaitSec: 30,
    env: { FOO: "bar" },
    caCerts: "",
    bootstrap: { onCreateScripts: ["./setup.sh"], onStartScripts: ["./start.sh"] },
    agent: {
      name: "codex",
      binary: "codex",
      defaultArgs: [],
      vmName: "agentbox-test",
    },
    ...overrides,
  };
}

describe("ensureRunning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lima.create).mockReturnValue(0);
    vi.mocked(lima.start).mockReturnValue(0);
    vi.mocked(lima.stop).mockReturnValue(0);
    vi.mocked(lima.waitForSsh).mockResolvedValue(undefined);
    vi.mocked(lima.shellNonInteractive).mockReturnValue(0);
  });

  it("creates new VM when state is empty", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    await ensureRunning(makeConfig());

    expect(lima.create).toHaveBeenCalled();
    expect(lima.start).toHaveBeenCalledTimes(2); // first start + restart for groups
    expect(lima.stop).toHaveBeenCalledTimes(1); // stop before restart
    expect(lima.waitForSsh).toHaveBeenCalled();
  });

  it("runs both onCreate and onStart bootstrap for new VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    await ensureRunning(makeConfig());

    expect(runBootstrap).toHaveBeenCalledWith(
      "onCreate", "agentbox-test", "/workspace", ["./setup.sh"], { FOO: "bar" },
    );
    expect(runBootstrap).toHaveBeenCalledWith(
      "onStart", "agentbox-test", "/workspace", ["./start.sh"], { FOO: "bar" },
    );
  });

  it("injects credentials and env for new VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    await ensureRunning(makeConfig());

    expect(injectCredentials).toHaveBeenCalledWith("agentbox-test", "/workspace");
    expect(injectEnvVars).toHaveBeenCalledWith("agentbox-test", "/workspace", { FOO: "bar" });
  });

  it("installs readonly-remote when remoteWrite is false", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    await ensureRunning(makeConfig({ remoteWrite: false }));

    expect(installReadonlyRemote).toHaveBeenCalledWith("agentbox-test", "/workspace");
  });

  it("skips readonly-remote when remoteWrite is true", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    await ensureRunning(makeConfig({ remoteWrite: true }));

    expect(installReadonlyRemote).not.toHaveBeenCalled();
  });

  it("starts stopped VM without recreating", async () => {
    vi.mocked(lima.getState).mockReturnValue("Stopped");
    await ensureRunning(makeConfig());

    expect(lima.create).not.toHaveBeenCalled();
    expect(lima.start).toHaveBeenCalledTimes(1);
    expect(lima.waitForSsh).toHaveBeenCalled();
  });

  it("only runs onStart bootstrap (not onCreate) for stopped VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("Stopped");
    await ensureRunning(makeConfig());

    expect(runBootstrap).toHaveBeenCalledTimes(1);
    expect(runBootstrap).toHaveBeenCalledWith(
      "onStart", expect.any(String), expect.any(String), expect.any(Array), expect.any(Object),
    );
  });

  it("deletes and recreates broken VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("Broken");
    await ensureRunning(makeConfig());

    expect(lima.remove).toHaveBeenCalledWith("agentbox-test");
    expect(lima.create).toHaveBeenCalled();
    expect(lima.start).toHaveBeenCalled();
  });

  it("runs both onCreate and onStart for broken VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("Broken");
    await ensureRunning(makeConfig());

    expect(runBootstrap).toHaveBeenCalledWith(
      "onCreate", expect.any(String), expect.any(String), expect.any(Array), expect.any(Object),
    );
    expect(runBootstrap).toHaveBeenCalledWith(
      "onStart", expect.any(String), expect.any(String), expect.any(Array), expect.any(Object),
    );
  });

  it("only runs onStart for already running VM", async () => {
    vi.mocked(lima.getState).mockReturnValue("Running");
    await ensureRunning(makeConfig());

    expect(lima.create).not.toHaveBeenCalled();
    expect(lima.start).not.toHaveBeenCalled();
    expect(runBootstrap).toHaveBeenCalledTimes(1);
    expect(runBootstrap).toHaveBeenCalledWith(
      "onStart", expect.any(String), expect.any(String), expect.any(Array), expect.any(Object),
    );
  });

  it("throws when VM creation fails", async () => {
    vi.mocked(lima.getState).mockReturnValue("");
    vi.mocked(lima.create).mockReturnValue(1);

    await expect(ensureRunning(makeConfig())).rejects.toThrow("failed to create VM");
  });

  it("throws when VM start fails", async () => {
    vi.mocked(lima.getState).mockReturnValue("Stopped");
    vi.mocked(lima.start).mockReturnValue(1);

    await expect(ensureRunning(makeConfig())).rejects.toThrow("failed to start VM");
  });
});
