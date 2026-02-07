import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../docker/sandbox.js", () => ({
  execWithStdinPipe: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { execWithStdinPipe } from "../docker/sandbox.js";
import { injectCodexCredentials } from "./presets.js";

const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);
const mockExec = vi.mocked(execWithStdinPipe);

beforeEach(() => {
  mockExists.mockReset();
  mockRead.mockReset();
  mockExec.mockReset();
});

describe("injectCodexCredentials", () => {
  it("copies existing ~/.codex files into /home/agent", () => {
    mockExists.mockImplementation((p) =>
      String(p) === "/home/test/.codex/auth.json" || String(p) === "/home/test/.codex/config.toml",
    );
    mockRead.mockReturnValue(Buffer.from("x"));

    injectCodexCredentials("codex-myproj", ["~/.codex/auth.json", "~/.codex/config.toml"]);

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec.mock.calls[0][0]).toBe("codex-myproj");
    expect(mockExec.mock.calls[0][1]).toContain('/home/agent/.codex/auth.json');
    expect(mockExec.mock.calls[1][1]).toContain('/home/agent/.codex/config.toml');
  });

  it("skips non-~/ paths", () => {
    injectCodexCredentials("codex-myproj", ["/abs/path/auth.json"]);
    expect(mockExec).toHaveBeenCalledTimes(0);
  });
});

