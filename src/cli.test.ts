import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "./config/schema.js";
import { dispatch, withDefaultModel } from "./cli.js";
import * as docker from "./docker/sandbox.js";
import * as base from "./agents/base.js";

function makeRunModeConfig(
  agentName: ResolvedConfig["agent"]["name"],
  options?: {
    defaultArgs?: string[];
    model?: string;
  },
): ResolvedConfig {
  return {
    workspace: "/tmp/workspace",
    syncFiles: [],
    startupWaitSec: 5,
    env: {},
    bootstrap: { onCreateScripts: [], onStartScripts: [] },
    agent: {
      name: agentName,
      execMode: "run",
      binary: agentName,
      defaultArgs: options?.defaultArgs ?? [],
      model: options?.model,
      sandboxName: `${agentName}-test`,
      credentials: { enabled: true, files: [] },
    },
  };
}

function mockProcessExit(): void {
  vi.spyOn(process, "exit").mockImplementation(((
    code?: string | number | null | undefined,
  ) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
}

describe("withDefaultModel", () => {
  it("injects model for top-level model agents", () => {
    expect(withDefaultModel("claude", ["prompt", "hi"], "sonnet")).toEqual([
      "--model",
      "sonnet",
      "prompt",
      "hi",
    ]);
  });

  it("does not inject when user already passed --model", () => {
    expect(withDefaultModel("claude", ["--model", "haiku", "prompt", "hi"], "sonnet")).toEqual([
      "--model",
      "haiku",
      "prompt",
      "hi",
    ]);
  });

  it("does not inject when user already passed --model=<value>", () => {
    expect(withDefaultModel("claude", ["--model=haiku", "prompt", "hi"], "sonnet")).toEqual([
      "--model=haiku",
      "prompt",
      "hi",
    ]);
  });

  it("injects model after chat for kiro", () => {
    expect(withDefaultModel("kiro", ["chat", "hello"], "gpt-5")).toEqual([
      "chat",
      "--model",
      "gpt-5",
      "hello",
    ]);
  });

  it("keeps kiro args unchanged when chat subcommand is absent", () => {
    expect(withDefaultModel("kiro", ["--help"], "gpt-5")).toEqual(["--help"]);
  });
});

describe("dispatch run-mode passthrough", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not prepend defaultArgs in run-mode passthrough", async () => {
    const config = makeRunModeConfig("kiro", {
      defaultArgs: ["chat", "--trust-all-tools"],
    });

    vi.spyOn(base, "ensureRunning").mockResolvedValue(undefined);
    const runSpy = vi.spyOn(docker, "run").mockReturnValue(0);
    mockProcessExit();

    await expect(dispatch("kiro", "--help", [], config)).rejects.toThrow("process.exit:0");

    expect(runSpy).toHaveBeenCalledWith("kiro-test", ["--", "--help"]);
  });

  it("injects model in run-mode passthrough without adding defaultArgs", async () => {
    const config = makeRunModeConfig("claude", {
      defaultArgs: ["--dangerously-skip-permissions"],
      model: "claude-3-7-sonnet",
    });

    vi.spyOn(base, "ensureRunning").mockResolvedValue(undefined);
    const runSpy = vi.spyOn(docker, "run").mockReturnValue(0);
    mockProcessExit();

    await expect(dispatch("claude", "prompt", ["hello"], config)).rejects.toThrow(
      "process.exit:0",
    );

    expect(runSpy).toHaveBeenCalledWith("claude-test", [
      "--",
      "--model",
      "claude-3-7-sonnet",
      "prompt",
      "hello",
    ]);
  });
});

