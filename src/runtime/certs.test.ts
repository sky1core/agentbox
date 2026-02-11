import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils/process.js", () => ({
  execCapture: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, platform: vi.fn() };
});

import { detectHostCACerts, collectCACerts } from "./certs.js";
import { execCapture } from "../utils/process.js";
import { readFileSync } from "node:fs";
import { platform } from "node:os";

const CERT_A = `-----BEGIN CERTIFICATE-----
MIIC1TCCAb0=
-----END CERTIFICATE-----`;

const CERT_B = `-----BEGIN CERTIFICATE-----
MIID2TCCAsE=
-----END CERTIFICATE-----`;

describe("detectHostCACerts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns PEM on macOS when security command succeeds", () => {
    vi.mocked(platform).mockReturnValue("darwin");
    vi.mocked(execCapture).mockReturnValue({
      status: 0,
      stdout: CERT_A + "\n",
      stderr: "",
    });

    const result = detectHostCACerts();
    expect(result).toContain("BEGIN CERTIFICATE");
    expect(execCapture).toHaveBeenCalledWith("security", [
      "find-certificate", "-a", "-p",
      "/Library/Keychains/System.keychain",
    ]);
  });

  it("returns empty string on non-macOS", () => {
    vi.mocked(platform).mockReturnValue("linux");

    const result = detectHostCACerts();
    expect(result).toBe("");
    expect(execCapture).not.toHaveBeenCalled();
  });

  it("returns empty string when security command fails", () => {
    vi.mocked(platform).mockReturnValue("darwin");
    vi.mocked(execCapture).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "error",
    });

    const result = detectHostCACerts();
    expect(result).toBe("");
  });
});

describe("collectCACerts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    // Default: not macOS (skip auto-detect in most tests)
    vi.mocked(platform).mockReturnValue("linux");
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty string when no sources available", () => {
    const result = collectCACerts();
    expect(result).toBe("");
  });

  it("reads from config cert path", () => {
    vi.mocked(readFileSync).mockReturnValue(CERT_A + "\n");

    const result = collectCACerts("/path/to/cert.pem");
    expect(result).toContain("BEGIN CERTIFICATE");
    expect(readFileSync).toHaveBeenCalledWith("/path/to/cert.pem", "utf-8");
  });

  it("reads from NODE_EXTRA_CA_CERTS", () => {
    process.env.NODE_EXTRA_CA_CERTS = "/etc/custom-ca.pem";
    vi.mocked(readFileSync).mockReturnValue(CERT_B + "\n");

    const result = collectCACerts();
    expect(result).toContain("MIID2TCCAsE=");
    expect(readFileSync).toHaveBeenCalledWith("/etc/custom-ca.pem", "utf-8");
  });

  it("includes macOS System Keychain auto-detect", () => {
    vi.mocked(platform).mockReturnValue("darwin");
    vi.mocked(execCapture).mockReturnValue({
      status: 0,
      stdout: CERT_A + "\n",
      stderr: "",
    });

    const result = collectCACerts();
    expect(result).toContain("MIIC1TCCAb0=");
  });

  it("deduplicates identical certificates across sources", () => {
    vi.mocked(platform).mockReturnValue("darwin");
    vi.mocked(readFileSync).mockReturnValue(CERT_A + "\n");
    vi.mocked(execCapture).mockReturnValue({
      status: 0,
      stdout: CERT_A + "\n",
      stderr: "",
    });

    const result = collectCACerts("/path/to/cert.pem");
    const matches = result.match(/BEGIN CERTIFICATE/g);
    expect(matches).toHaveLength(1);
  });

  it("combines certificates from multiple sources", () => {
    process.env.NODE_EXTRA_CA_CERTS = "/etc/custom-ca.pem";
    vi.mocked(readFileSync)
      .mockReturnValueOnce(CERT_A + "\n")
      .mockReturnValueOnce(CERT_B + "\n");

    const result = collectCACerts("/path/to/cert.pem");
    const matches = result.match(/BEGIN CERTIFICATE/g);
    expect(matches).toHaveLength(2);
    expect(result).toContain("MIIC1TCCAb0=");
    expect(result).toContain("MIID2TCCAsE=");
  });

  it("skips unreadable files gracefully", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = collectCACerts("/nonexistent/cert.pem");
    expect(result).toBe("");
  });
});
