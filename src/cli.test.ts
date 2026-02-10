import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "./config/schema.js";
import { dispatch, withDefaultModel } from "./cli.js";
import * as lima from "./runtime/lima.js";
import * as base from "./agents/base.js";

function makeConfig(
  agentName: ResolvedConfig["agent"]["name"],
  options?: {
    defaultArgs?: string[];
    model?: string;
    binary?: string;
  },
): ResolvedConfig {
  return {
    workspace: "/tmp/workspace",
    remoteWrite: false,
    vm: { cpus: 4, memory: "8GiB", disk: "50GiB" },
    mounts: [],
    startupWaitSec: 5,
    env: {},
    bootstrap: { onCreateScripts: [], onStartScripts: [] },
    agent: {
      name: agentName,
      binary: options?.binary ?? agentName,
      defaultArgs: options?.defaultArgs ?? [],
      model: options?.model,
      vmName: "agentbox-test",
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

describe("dispatch passthrough", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses lima.shellInteractive for interactive passthrough", async () => {
    const config = makeConfig("codex", {
      defaultArgs: ["--approval-mode", "full-auto"],
    });

    vi.spyOn(base, "ensureRunning").mockResolvedValue(undefined);
    const shellSpy = vi.spyOn(lima, "shellInteractive").mockReturnValue(0);
    vi.spyOn(lima, "shellNonInteractive").mockReturnValue(0);
    mockProcessExit();

    // Simulate TTY
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    await expect(dispatch("codex", "--help", [], config)).rejects.toThrow("process.exit:0");

    expect(shellSpy).toHaveBeenCalledWith(
      "agentbox-test",
      "/tmp/workspace",
      ["codex", "--approval-mode", "full-auto", "--help"],
      {},
    );
  });

  it("includes defaultArgs in passthrough", async () => {
    const config = makeConfig("claude", {
      defaultArgs: ["--dangerously-skip-permissions"],
      model: "claude-3-7-sonnet",
    });

    vi.spyOn(base, "ensureRunning").mockResolvedValue(undefined);
    const shellSpy = vi.spyOn(lima, "shellInteractive").mockReturnValue(0);
    vi.spyOn(lima, "shellNonInteractive").mockReturnValue(0);
    mockProcessExit();

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    await expect(dispatch("claude", "prompt", ["hello"], config)).rejects.toThrow(
      "process.exit:0",
    );

    expect(shellSpy).toHaveBeenCalledWith(
      "agentbox-test",
      "/tmp/workspace",
      ["claude", "--model", "claude-3-7-sonnet", "--dangerously-skip-permissions", "prompt", "hello"],
      {},
    );
  });

  it("uses binary from config", async () => {
    const config = makeConfig("kiro", {
      binary: "kiro-cli",
      defaultArgs: ["chat", "--trust-all-tools"],
    });

    vi.spyOn(base, "ensureRunning").mockResolvedValue(undefined);
    const shellSpy = vi.spyOn(lima, "shellInteractive").mockReturnValue(0);
    vi.spyOn(lima, "shellNonInteractive").mockReturnValue(0);
    mockProcessExit();

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    await expect(dispatch("kiro", undefined, [], config)).rejects.toThrow("process.exit:0");

    expect(shellSpy).toHaveBeenCalledWith(
      "agentbox-test",
      "/tmp/workspace",
      ["kiro-cli", "chat", "--trust-all-tools"],
      {},
    );
  });
});
