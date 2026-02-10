import { describe, it, expect } from "vitest";
import { COMMON_COMMANDS } from "./types.js";

describe("COMMON_COMMANDS", () => {
  it("exposes only agentbox reserved commands", () => {
    expect(Object.keys(COMMON_COMMANDS).sort()).toEqual(["ls", "rm", "shell", "stop"]);
  });
});
