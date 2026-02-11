import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils/process.js", () => ({
  execCapture: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(), mkdirSync: vi.fn() };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, platform: vi.fn(), homedir: vi.fn().mockReturnValue("/home/test") };
});

import { listCustomKeychainCerts, collectCACerts, saveCertFile } from "./certs.js";
import { execCapture } from "../utils/process.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { platform, homedir } from "node:os";

const CERT_A = `-----BEGIN CERTIFICATE-----
MIIC1TCCAb0=
-----END CERTIFICATE-----`;

const CERT_B = `-----BEGIN CERTIFICATE-----
MIID2TCCAsE=
-----END CERTIFICATE-----`;

describe("listCustomKeychainCerts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array on non-macOS", () => {
    vi.mocked(platform).mockReturnValue("linux");
    expect(listCustomKeychainCerts()).toEqual([]);
  });

  it("filters out Apple default certs", () => {
    vi.mocked(platform).mockReturnValue("darwin");

    // Meta output with labels
    vi.mocked(execCapture)
      .mockReturnValueOnce({
        status: 0,
        stdout: [
          '    "labl"<blob>="com.apple.systemdefault"',
          '    "labl"<blob>="Apple Worldwide Developer Relations"',
          '    "labl"<blob>="INTEREZEN CA"',
        ].join("\n"),
        stderr: "",
      })
      // PEM output (3 certs in same order)
      .mockReturnValueOnce({
        status: 0,
        stdout: CERT_A + "\n" + CERT_B + "\n" + CERT_A + "\n",
        stderr: "",
      });

    const result = listCustomKeychainCerts();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("INTEREZEN CA");
  });

  it("returns empty when security command fails", () => {
    vi.mocked(platform).mockReturnValue("darwin");
    vi.mocked(execCapture).mockReturnValue({ status: 1, stdout: "", stderr: "err" });
    expect(listCustomKeychainCerts()).toEqual([]);
  });
});

describe("collectCACerts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty string when no sources available", () => {
    expect(collectCACerts()).toBe("");
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
  });

  it("deduplicates identical certificates", () => {
    process.env.NODE_EXTRA_CA_CERTS = "/etc/custom-ca.pem";
    vi.mocked(readFileSync).mockReturnValue(CERT_A + "\n");
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
  });

  it("skips unreadable files gracefully", () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });
    expect(collectCACerts("/nonexistent")).toBe("");
  });
});

describe("saveCertFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(homedir).mockReturnValue("/home/test");
  });

  it("saves to global path", () => {
    const cert = { label: "Test CA", pem: CERT_A };
    const path = saveCertFile([cert], true);
    expect(path).toContain("ca-certificates.pem");
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("saves to local workspace path", () => {
    const cert = { label: "Test CA", pem: CERT_A };
    const path = saveCertFile([cert], false, "/workspace");
    expect(path).toBe("/workspace/agentbox-ca.pem");
    expect(writeFileSync).toHaveBeenCalled();
  });
});
