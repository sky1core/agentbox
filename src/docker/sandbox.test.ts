import { describe, expect, it } from "vitest";
import { buildNetworkProxyArgs } from "./sandbox.js";

describe("buildNetworkProxyArgs", () => {
  it("builds docker sandbox network proxy flags", () => {
    const args = buildNetworkProxyArgs("claude-myproj", {
      policy: "deny",
      allowHosts: ["host.docker.internal", "localhost"],
      blockHosts: ["bad.example.com"],
      allowCidrs: ["10.0.0.0/8"],
      blockCidrs: ["192.168.0.0/16"],
      bypassHosts: ["registry.npmjs.org"],
      bypassCidrs: ["172.16.0.0/12"],
    });
    expect(args).toEqual([
      "sandbox",
      "network",
      "proxy",
      "claude-myproj",
      "--policy",
      "deny",
      "--allow-host",
      "host.docker.internal",
      "--allow-host",
      "localhost",
      "--block-host",
      "bad.example.com",
      "--allow-cidr",
      "10.0.0.0/8",
      "--block-cidr",
      "192.168.0.0/16",
      "--bypass-host",
      "registry.npmjs.org",
      "--bypass-cidr",
      "172.16.0.0/12",
    ]);
  });

  it("drops empty values", () => {
    const args = buildNetworkProxyArgs("claude-myproj", {
      allowHosts: ["", "   ", "localhost"],
    });
    expect(args).toEqual([
      "sandbox",
      "network",
      "proxy",
      "claude-myproj",
      "--allow-host",
      "localhost",
    ]);
  });
});

