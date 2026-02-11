import { describe, it, expect, vi } from "vitest";

// Mock certs module to isolate loader tests from host OS (macOS auto-detect)
vi.mock("../runtime/certs.js", () => ({
  collectCACerts: vi.fn().mockReturnValue(""),
}));

import { resolveConfig } from "./loader.js";
import type { GlobalConfig, LocalConfig } from "./schema.js";

describe("resolveConfig", () => {
  const minimalLocal: LocalConfig = {
    workspace: "/home/user/work/my-project",
  };

  it("uses hardcoded defaults when no global config", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.workspace).toBe("/home/user/work/my-project");
    expect(config.startupWaitSec).toBe(30);
    expect(config.agent.name).toBe("codex");
    expect(config.agent.binary).toBe("codex");
    expect(config.agent.vmName).toBe("agentbox-my-project");
  });

  it("uses correct binary for claude", () => {
    const config = resolveConfig("claude", minimalLocal, {});
    expect(config.agent.binary).toBe("claude");
    expect(config.agent.vmName).toBe("agentbox-my-project");
  });

  it("vm defaults are applied", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.vm).toEqual({ cpus: 4, memory: "8GiB", disk: "20GiB" });
  });

  it("global vm config overrides defaults", () => {
    const global: GlobalConfig = {
      vm: { cpus: 8, memory: "16GiB" },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.vm.cpus).toBe(8);
    expect(config.vm.memory).toBe("16GiB");
    expect(config.vm.disk).toBe("20GiB"); // default preserved
  });

  it("local vm config overrides global", () => {
    const global: GlobalConfig = { vm: { cpus: 8 } };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      vm: { cpus: 2 },
    };
    const config = resolveConfig("codex", local, global);
    expect(config.vm.cpus).toBe(2);
  });

  it("global config overrides defaults", () => {
    const global: GlobalConfig = {
      defaults: { startupWaitSec: 10 },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.startupWaitSec).toBe(10);
  });

  it("local config overrides global config", () => {
    const global: GlobalConfig = {
      defaults: { startupWaitSec: 10 },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      startupWaitSec: 3,
    };
    const config = resolveConfig("codex", local, global);
    expect(config.startupWaitSec).toBe(3);
  });

  it("local vmName overrides auto-generated name", () => {
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      agents: {
        codex: { vmName: "custom-name" },
      },
    };
    const config = resolveConfig("codex", local, {});
    expect(config.agent.vmName).toBe("custom-name");
  });

  it("remoteWrite defaults to false", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.remoteWrite).toBe(false);
  });

  it("global config can set remoteWrite to true", () => {
    const global: GlobalConfig = {
      sync: { remoteWrite: true },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.remoteWrite).toBe(true);
  });

  it("local config overrides global remoteWrite", () => {
    const global: GlobalConfig = {
      sync: { remoteWrite: true },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      sync: { remoteWrite: false },
    };
    const config = resolveConfig("codex", local, global);
    expect(config.remoteWrite).toBe(false);
  });

  it("env defaults to empty object", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.env).toEqual({});
  });

  it("global env is used when local env is absent", () => {
    const global: GlobalConfig = {
      env: { FOO: "bar", BAZ: "qux" },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.env).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("local env overrides global env per-key", () => {
    const global: GlobalConfig = {
      env: { FOO: "global", BAR: "global" },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      env: { FOO: "local" },
    };
    const config = resolveConfig("codex", local, global);
    expect(config.env).toEqual({ FOO: "local", BAR: "global" });
  });

  it("mounts default to empty array", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.mounts).toEqual([]);
  });

  it("global mounts are used when local absent", () => {
    const global: GlobalConfig = {
      mounts: [{ location: "~/data", writable: false }],
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.mounts).toEqual([{ location: "~/data", writable: false }]);
  });

  it("local mounts override global entirely", () => {
    const global: GlobalConfig = {
      mounts: [{ location: "~/data" }],
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      mounts: [{ location: "~/other", writable: true }],
    };
    const config = resolveConfig("codex", local, global);
    expect(config.mounts).toEqual([{ location: "~/other", writable: true }]);
  });

  it("bootstrap scripts concat global then local", () => {
    const global: GlobalConfig = {
      bootstrap: { onCreateScript: "global-create.sh", onStartScript: "global-start.sh" },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      bootstrap: { onCreateScript: "local-create.sh", onStartScript: ["local-start1.sh", "local-start2.sh"] },
    };
    const config = resolveConfig("codex", local, global);
    expect(config.bootstrap.onCreateScripts).toEqual(["global-create.sh", "local-create.sh"]);
    expect(config.bootstrap.onStartScripts).toEqual(["global-start.sh", "local-start1.sh", "local-start2.sh"]);
  });

  it("model from local agent overrides global agent", () => {
    const global: GlobalConfig = {
      agents: { codex: { model: "o3" } },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      agents: { codex: { model: "o4-mini" } },
    };
    const config = resolveConfig("codex", local, global);
    expect(config.agent.model).toBe("o4-mini");
  });
});
