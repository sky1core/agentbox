import { describe, it, expect } from "vitest";
import type { ResolvedConfig } from "../config/schema.js";

describe("ResolvedConfig.agent.name", () => {
  it("agent name is directly available without parsing vmName", () => {
    const config: ResolvedConfig = {
      workspace: "/tmp/test",
      remoteWrite: false,
      vm: { cpus: 4, memory: "8GiB", disk: "50GiB" },
      mounts: [],
      startupWaitSec: 5,
      env: {},
      bootstrap: { onCreateScripts: [], onStartScripts: [] },
      agent: {
        name: "codex",
        defaultArgs: [],
        vmName: "custom-name-with-hyphens",
      },
    };
    expect(config.agent.name).toBe("codex");
  });

  it("works with custom vmName that doesn't follow agentbox-project pattern", () => {
    const config: ResolvedConfig = {
      workspace: "/tmp/test",
      remoteWrite: false,
      vm: { cpus: 4, memory: "8GiB", disk: "50GiB" },
      mounts: [],
      startupWaitSec: 5,
      env: {},
      bootstrap: { onCreateScripts: [], onStartScripts: [] },
      agent: {
        name: "claude",
        defaultArgs: [],
        vmName: "my-special-vm",
      },
    };
    expect(config.agent.name).toBe("claude");
  });
});
