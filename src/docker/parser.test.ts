import { describe, it, expect } from "vitest";
import { parseSandboxState } from "./parser.js";

const SAMPLE_LS = `NAME              AGENT    STATUS
codex-myproj      codex    running
claude-myproj     claude   stopped
gemini-other      gemini   running`;

describe("parseSandboxState", () => {
  it("finds a running sandbox", () => {
    expect(parseSandboxState(SAMPLE_LS, "codex-myproj")).toBe("running");
  });

  it("finds a stopped sandbox", () => {
    expect(parseSandboxState(SAMPLE_LS, "claude-myproj")).toBe("stopped");
  });

  it("returns empty string for missing sandbox", () => {
    expect(parseSandboxState(SAMPLE_LS, "kiro-unknown")).toBe("");
  });

  it("handles empty output", () => {
    expect(parseSandboxState("", "codex-myproj")).toBe("");
  });

  it("does not match partial names", () => {
    expect(parseSandboxState(SAMPLE_LS, "codex-my")).toBe("");
  });
});
