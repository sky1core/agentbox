import { describe, it, expect } from "vitest";
import { resolveConfig } from "./loader.js";
import type { GlobalConfig, LocalConfig } from "./schema.js";

describe("resolveConfig", () => {
  const minimalLocal: LocalConfig = {
    workspace: "/home/user/work/my-project",
  };

  it("uses hardcoded defaults when no global config", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.workspace).toBe("/home/user/work/my-project");
    expect(config.syncFiles).toEqual([]);
    expect(config.startupWaitSec).toBe(5);
    expect(config.agent.name).toBe("codex");
    expect(config.agent.execMode).toBe("exec");
    expect(config.agent.binary).toBe("codex");
    expect(config.agent.sandboxName).toBe("codex-my-project");
  });

  it("uses run execMode for claude", () => {
    const config = resolveConfig("claude", minimalLocal, {});
    expect(config.agent.execMode).toBe("run");
    expect(config.agent.binary).toBe("claude");
    expect(config.agent.sandboxName).toBe("claude-my-project");
  });

  it("global config overrides defaults", () => {
    const global: GlobalConfig = {
      sync: { files: ["~/.netrc", "~/.gitconfig"] },
      defaults: { startupWaitSec: 10 },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.syncFiles).toEqual(["~/.netrc", "~/.gitconfig"]);
    expect(config.startupWaitSec).toBe(10);
  });

  it("local config overrides global config", () => {
    const global: GlobalConfig = {
      sync: { files: ["~/.netrc", "~/.gitconfig"] },
      defaults: { startupWaitSec: 10 },
    };
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      sync: { files: ["~/.netrc"] },
      startupWaitSec: 3,
    };
    const config = resolveConfig("codex", local, global);
    expect(config.syncFiles).toEqual(["~/.netrc"]);
    expect(config.startupWaitSec).toBe(3);
  });

  it("local sandboxName overrides auto-generated name", () => {
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      agents: {
        codex: { sandboxName: "custom-name" },
      },
    };
    const config = resolveConfig("codex", local, {});
    expect(config.agent.name).toBe("codex");
    expect(config.agent.sandboxName).toBe("custom-name");
  });

  it("global agent config overrides defaults", () => {
    const global: GlobalConfig = {
      agents: {
        codex: { execMode: "run" },
      },
    };
    const config = resolveConfig("codex", minimalLocal, global);
    expect(config.agent.execMode).toBe("run");
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

  it("local remoteWrite true overrides default false", () => {
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      sync: { remoteWrite: true },
    };
    const config = resolveConfig("codex", local, {});
    expect(config.remoteWrite).toBe(true);
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

  it("enables credential injection by default and sets codex default credential files", () => {
    const config = resolveConfig("codex", minimalLocal, {});
    expect(config.agent.credentials.enabled).toBe(true);
    expect(config.agent.credentials.files).toEqual(["~/.codex/auth.json"]);
  });

  it("allows disabling credential injection per-agent via local config", () => {
    const local: LocalConfig = {
      workspace: "/home/user/work/my-project",
      agents: {
        gemini: { credentials: { enabled: false } },
      },
    };
    const config = resolveConfig("gemini", local, {});
    expect(config.agent.credentials.enabled).toBe(false);
  });
});
