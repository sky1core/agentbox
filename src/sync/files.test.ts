import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { expandHome } from "./files.js";

describe("expandHome", () => {
  it("expands ~/path to homedir/path", () => {
    expect(expandHome("~/.netrc")).toBe(resolve(homedir(), ".netrc"));
  });

  it("expands ~/nested/path correctly", () => {
    expect(expandHome("~/a/b/c")).toBe(resolve(homedir(), "a/b/c"));
  });

  it("does not expand paths without ~/", () => {
    expect(expandHome("/absolute/path")).toBe(resolve("/absolute/path"));
  });

  it("does not expand ~ in the middle of path", () => {
    expect(expandHome("/some/~/path")).toBe(resolve("/some/~/path"));
  });

  it("resolves relative paths without ~", () => {
    expect(expandHome("relative/path")).toBe(resolve("relative/path"));
  });

  it("handles ~/ with empty remainder", () => {
    expect(expandHome("~/")).toBe(resolve(homedir(), ""));
  });
});
