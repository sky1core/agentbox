import { describe, it, expect, vi } from "vitest";
import { buildTemplate } from "./lima.js";
import type { ResolvedConfig } from "../config/schema.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    workspace: "/Users/sky1core/work/my-project",
    remoteWrite: false,
    vm: { cpus: 4, memory: "8GiB", disk: "50GiB" },
    mounts: [],
    startupWaitSec: 30,
    env: {},
    caCerts: "",
    bootstrap: { onCreateScripts: [], onStartScripts: [] },
    agent: {
      name: "codex",
      binary: "codex",
      defaultArgs: ["--approval-mode", "full-auto"],
      vmName: "agentbox-my-project",
    },
    ...overrides,
  };
}

describe("buildTemplate", () => {
  it("generates valid YAML with workspace mount", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).toContain('vmType: "vz"');
    expect(yaml).toContain("cpus: 4");
    expect(yaml).toContain('memory: "8GiB"');
    expect(yaml).toContain('disk: "50GiB"');
    expect(yaml).toContain('location: "/Users/sky1core/work/my-project"');
    expect(yaml).toContain("writable: true");
  });

  it("does NOT mount home directory (credentials injected via limactl copy)", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).not.toContain('location: "~"');
  });

  it("includes rosetta config", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).toContain("rosetta:");
    expect(yaml).toContain("enabled: true");
    expect(yaml).toContain("binfmt: true");
  });

  it("includes custom mounts", () => {
    const yaml = buildTemplate(makeConfig({
      mounts: [
        { location: "~/data", writable: true },
        { location: "/opt/tools", mountPoint: "/tools", writable: false },
      ],
    }));
    expect(yaml).toContain('location: "~/data"');
    expect(yaml).toContain('location: "/opt/tools"');
    expect(yaml).toContain('mountPoint: "/tools"');
  });

  it("uses custom vm resources", () => {
    const yaml = buildTemplate(makeConfig({
      vm: { cpus: 8, memory: "16GiB", disk: "100GiB" },
    }));
    expect(yaml).toContain("cpus: 8");
    expect(yaml).toContain('memory: "16GiB"');
    expect(yaml).toContain('disk: "100GiB"');
  });

  it("includes provision scripts for system packages", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).toContain("provision:");
    expect(yaml).toContain("apt-get install -y curl git build-essential unzip jq docker.io");
    expect(yaml).toContain("nodejs");
    expect(yaml).toContain("gh");
  });

  it("includes agent CLI installation", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).toContain("@anthropic-ai/claude-code");
    expect(yaml).toContain("@openai/codex");
    expect(yaml).toContain("@google/gemini-cli");
    expect(yaml).toContain("kiro.dev/install");
  });

  it("includes approval-free settings for agents", () => {
    const yaml = buildTemplate(makeConfig());
    expect(yaml).toContain("bypassPermissions");
    expect(yaml).toContain('approval_policy = "never"');
    expect(yaml).toContain('sandbox_mode = "danger-full-access"');
    expect(yaml).toContain("auto_edit");
  });

  it("omits caCerts section when no certs provided", () => {
    const yaml = buildTemplate(makeConfig({ caCerts: "" }));
    expect(yaml).not.toContain("caCerts:");
    expect(yaml).not.toContain("NODE_EXTRA_CA_CERTS");
  });

  it("includes caCerts section when certs are provided", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nMIIC1TCCAb0=\n-----END CERTIFICATE-----\n";
    const yaml = buildTemplate(makeConfig({ caCerts: cert }));
    expect(yaml).toContain("caCerts:");
    expect(yaml).toContain("certs:");
    expect(yaml).toContain("-----BEGIN CERTIFICATE-----");
    expect(yaml).toContain("MIIC1TCCAb0=");
    expect(yaml).toContain("-----END CERTIFICATE-----");
  });

  it("includes NODE_EXTRA_CA_CERTS in provision when caCerts provided", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nMIIC1TCCAb0=\n-----END CERTIFICATE-----\n";
    const yaml = buildTemplate(makeConfig({ caCerts: cert }));
    expect(yaml).toContain("NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt");
    expect(yaml).toContain("/etc/profile.d/node-ca-certs.sh");
  });

  it("handles multiple caCert blocks", () => {
    const certs = [
      "-----BEGIN CERTIFICATE-----\nAAA=\n-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----\nBBB=\n-----END CERTIFICATE-----",
    ].join("\n") + "\n";
    const yaml = buildTemplate(makeConfig({ caCerts: certs }));
    expect(yaml).toContain("AAA=");
    expect(yaml).toContain("BBB=");
    // Each cert should be a separate list item
    const matches = yaml.match(/- \|/g);
    expect(matches).toHaveLength(2);
  });
});

