import type { ResolvedConfig } from "../config/schema.js";
import * as lima from "../runtime/lima.js";
import { runBootstrap } from "../sync/bootstrap.js";
import { installReadonlyRemote, injectEnvVars, injectCredentials, syncKiroCredentials } from "../sync/presets.js";
import { log } from "../utils/logger.js";

function sleep(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

/**
 * Create and start a new VM. Returns after VM is Running.
 */
async function createAndStart(config: ResolvedConfig): Promise<void> {
  const { vmName } = config.agent;

  const createCode = lima.create(config);
  if (createCode !== 0) throw new Error(`failed to create VM '${vmName}' (exit=${createCode})`);

  log(`starting VM '${vmName}'...`);
  const startCode = lima.start(vmName);
  if (startCode !== 0) throw new Error(`failed to start VM '${vmName}' (exit=${startCode})`);

  await sleep(config.startupWaitSec);
}

export async function ensureRunning(config: ResolvedConfig): Promise<void> {
  const { vmName } = config.agent;
  const state = lima.getState(vmName);

  if (state === "") {
    log(`'${vmName}' not found. Creating...`);
    await createAndStart(config);

    injectCredentials(vmName, config.workspace);
    syncKiroCredentials(vmName, config.workspace);
    injectEnvVars(vmName, config.workspace, config.env);
    runBootstrap("onCreate", vmName, config.workspace, config.bootstrap.onCreateScripts, config.env);
    runBootstrap("onStart", vmName, config.workspace, config.bootstrap.onStartScripts, config.env);
    if (!config.remoteWrite) installReadonlyRemote(vmName, config.workspace);
    return;
  }

  if (state === "Stopped") {
    log(`starting ${vmName}...`);
    const code = lima.start(vmName);
    if (code !== 0) throw new Error(`failed to start VM '${vmName}' (exit=${code})`);
    await sleep(config.startupWaitSec);
  }

  if (state === "Broken") {
    log(`VM '${vmName}' is broken. Deleting and recreating...`);
    lima.remove(vmName);
    await createAndStart(config);

    injectCredentials(vmName, config.workspace);
    syncKiroCredentials(vmName, config.workspace);
    injectEnvVars(vmName, config.workspace, config.env);
    runBootstrap("onCreate", vmName, config.workspace, config.bootstrap.onCreateScripts, config.env);
    runBootstrap("onStart", vmName, config.workspace, config.bootstrap.onStartScripts, config.env);
    if (!config.remoteWrite) installReadonlyRemote(vmName, config.workspace);
    return;
  }

  // Running or Stopped (now restarted) — inject credentials and env, run onStart
  injectCredentials(vmName, config.workspace);
  syncKiroCredentials(vmName, config.workspace);
  injectEnvVars(vmName, config.workspace, config.env);
  runBootstrap("onStart", vmName, config.workspace, config.bootstrap.onStartScripts, config.env);
  if (!config.remoteWrite) installReadonlyRemote(vmName, config.workspace);
}
