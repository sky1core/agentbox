import type { ResolvedConfig } from "../config/schema.js";
import * as docker from "../docker/sandbox.js";
import { syncFiles } from "../sync/files.js";
import { runBootstrap } from "../sync/bootstrap.js";
import { installReadonlyRemote, injectGhToken, injectClaudeCredentials, injectKiroCredentials, injectGeminiCredentials, injectCodexCredentials, ensureCodexConfig, ensureHostDockerInternal, verifyProxyConnectivity } from "../sync/presets.js";
import { log } from "../utils/logger.js";

function sleep(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

export async function ensureRunning(config: ResolvedConfig): Promise<void> {
  const { sandboxName } = config.agent;
  const state = docker.getState(sandboxName);
  const credsEnabled = config.agent.credentials.enabled;

  if (state === "") {
    log(`'${sandboxName}' not found. Creating...`);
    docker.create(sandboxName, config.agent.name, config.workspace);
    await sleep(config.startupWaitSec);
    if (docker.configureNetworkProxy(sandboxName, config.networkProxy) !== 0) {
      log("WARNING: failed to apply sandbox network proxy options");
    }
    ensureHostDockerInternal(sandboxName, config.workspace);
    if (config.agent.name === "codex") ensureCodexConfig(sandboxName);
    injectGhToken(sandboxName);
    if (credsEnabled) {
      if (config.agent.name === "claude") injectClaudeCredentials(sandboxName, config.env);
      if (config.agent.name === "kiro") injectKiroCredentials(sandboxName);
      if (config.agent.name === "gemini") injectGeminiCredentials(sandboxName);
      if (config.agent.name === "codex") injectCodexCredentials(sandboxName, config.agent.credentials.files);
    }

    if (config.syncFiles.length > 0) syncFiles(sandboxName, config.syncFiles);
    runBootstrap("onCreate", sandboxName, config.workspace, config.bootstrap.onCreateScripts, config.env);
    runBootstrap("onStart", sandboxName, config.workspace, config.bootstrap.onStartScripts, config.env);
    if (!config.remoteWrite) installReadonlyRemote(sandboxName);
  } else {
    if (state === "stopped") {
      log(`starting ${sandboxName}...`);
      docker.runBackground(sandboxName);
      await sleep(config.startupWaitSec);
    }

    if (docker.configureNetworkProxy(sandboxName, config.networkProxy) !== 0) {
      log("WARNING: failed to apply sandbox network proxy options");
    }
    ensureHostDockerInternal(sandboxName, config.workspace);
    if (config.agent.name === "codex") ensureCodexConfig(sandboxName);
    injectGhToken(sandboxName);
    if (credsEnabled) {
      if (config.agent.name === "claude") injectClaudeCredentials(sandboxName, config.env);
      if (config.agent.name === "kiro") injectKiroCredentials(sandboxName);
      if (config.agent.name === "gemini") injectGeminiCredentials(sandboxName);
      if (config.agent.name === "codex") injectCodexCredentials(sandboxName, config.agent.credentials.files);
    }
    if (config.syncFiles.length > 0) syncFiles(sandboxName, config.syncFiles);
    runBootstrap("onStart", sandboxName, config.workspace, config.bootstrap.onStartScripts, config.env);
    if (!config.remoteWrite) installReadonlyRemote(sandboxName);
  }

  // Network health check: verify proxy connectivity after all setup
  if (!verifyProxyConnectivity(sandboxName, config.workspace)) {
    log("network check failed, retrying in 3s...");
    await sleep(3);
    // Re-pin /etc/hosts in case bootstrap or sync overwrote it
    ensureHostDockerInternal(sandboxName, config.workspace);
    if (!verifyProxyConnectivity(sandboxName, config.workspace)) {
      log("WARNING: sandbox network is not working");
      log(`  try: docker sandbox stop ${sandboxName}`);
      log("  then re-run agentbox");
    }
  }
}
