import { describe, it, expect } from "vitest";
import { isValidAgent, VALID_AGENTS } from "./schema.js";

describe("isValidAgent", () => {
  it("accepts all valid agent names", () => {
    for (const name of VALID_AGENTS) {
      expect(isValidAgent(name)).toBe(true);
    }
  });

  it("accepts 'codex'", () => {
    expect(isValidAgent("codex")).toBe(true);
  });

  it("accepts 'claude'", () => {
    expect(isValidAgent("claude")).toBe(true);
  });

  it("accepts 'kiro'", () => {
    expect(isValidAgent("kiro")).toBe(true);
  });

  it("accepts 'gemini'", () => {
    expect(isValidAgent("gemini")).toBe(true);
  });

  it("accepts 'copilot'", () => {
    expect(isValidAgent("copilot")).toBe(true);
  });

  it("accepts 'cagent'", () => {
    expect(isValidAgent("cagent")).toBe(true);
  });

  it("rejects 'unknown'", () => {
    expect(isValidAgent("unknown")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidAgent("")).toBe(false);
  });

  it("rejects uppercase 'CODEX'", () => {
    expect(isValidAgent("CODEX")).toBe(false);
  });

  it("rejects mixed case 'Claude'", () => {
    expect(isValidAgent("Claude")).toBe(false);
  });
});
