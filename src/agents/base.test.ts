import { describe, it, expect } from "vitest";
import type { ResolvedConfig } from "../config/schema.js";

describe("ResolvedConfig.agent.name", () => {
  it("agent name is directly available without parsing sandboxName", () => {
    const config: ResolvedConfig = {
      workspace: "/tmp/test",
      syncFiles: [],
      networkProxy: {
        allowHosts: [],
        blockHosts: [],
        allowCidrs: [],
        blockCidrs: [],
        bypassHosts: [],
        bypassCidrs: [],
      },
      startupWaitSec: 5,
      env: {},
      bootstrap: { onCreateScripts: [], onStartScripts: [] },
      agent: {
        name: "codex",
        execMode: "exec",
        defaultArgs: [],
        sandboxName: "custom-name-with-hyphens",
        credentials: { enabled: true, files: [] },
      },
    };
    expect(config.agent.name).toBe("codex");
  });

  it("works with custom sandboxName that doesn't follow agent-project pattern", () => {
    const config: ResolvedConfig = {
      workspace: "/tmp/test",
      syncFiles: [],
      networkProxy: {
        allowHosts: [],
        blockHosts: [],
        allowCidrs: [],
        blockCidrs: [],
        bypassHosts: [],
        bypassCidrs: [],
      },
      startupWaitSec: 5,
      env: {},
      bootstrap: { onCreateScripts: [], onStartScripts: [] },
      agent: {
        name: "claude",
        execMode: "run",
        defaultArgs: [],
        sandboxName: "my-special-sandbox",
        credentials: { enabled: true, files: [] },
      },
    };
    expect(config.agent.name).toBe("claude");
  });
});
