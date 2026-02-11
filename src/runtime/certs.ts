import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execCapture } from "../utils/process.js";

const PEM_BEGIN = "-----BEGIN CERTIFICATE-----";
const PEM_END = "-----END CERTIFICATE-----";

export interface KeychainCert {
  label: string;
  pem: string;
}

/**
 * Extract individual PEM certificate blocks from a string.
 */
function parsePemBlocks(pem: string): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of pem.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === PEM_BEGIN) {
      current = [trimmed];
    } else if (trimmed === PEM_END && current) {
      current.push(trimmed);
      blocks.push(current.join("\n"));
      current = null;
    } else if (current) {
      current.push(trimmed);
    }
  }
  return blocks;
}

/**
 * Parse cert labels from `security find-certificate -a` output.
 */
function parseLabels(output: string): string[] {
  const labels: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/"labl"<blob>="(.+?)"/);
    if (match) labels.push(match[1]);
  }
  return labels;
}

function isAppleDefault(label: string): boolean {
  return label.startsWith("com.apple.") || label.startsWith("Apple ");
}

/**
 * List non-Apple certificates from macOS System Keychain.
 * Returns empty array on non-macOS or if security command fails.
 */
export function listCustomKeychainCerts(): KeychainCert[] {
  if (platform() !== "darwin") return [];

  const KEYCHAIN = "/Library/Keychains/System.keychain";

  try {
    // Get labels (ordered)
    const metaResult = execCapture("security", ["find-certificate", "-a", KEYCHAIN]);
    if (metaResult.status !== 0) return [];

    // Get PEMs (same order)
    const pemResult = execCapture("security", ["find-certificate", "-a", "-p", KEYCHAIN]);
    if (pemResult.status !== 0) return [];

    const labels = parseLabels(metaResult.stdout);
    const pems = parsePemBlocks(pemResult.stdout);

    if (labels.length !== pems.length) return [];

    return labels
      .map((label, i) => ({ label, pem: pems[i] }))
      .filter((c) => !isAppleDefault(c.label));
  } catch {
    return [];
  }
}

/**
 * Save selected certs to a PEM file and return the file path.
 */
export function saveCertFile(certs: KeychainCert[], isGlobal: boolean, workspace?: string): string {
  let certPath: string;

  if (isGlobal) {
    const dir = join(homedir(), ".config", "agentbox");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    certPath = join(dir, "ca-certificates.pem");
  } else {
    if (!workspace) throw new Error("workspace is required for local cert file");
    certPath = join(workspace, "agentbox-ca.pem");
  }

  const content = certs.map((c) => c.pem).join("\n") + "\n";
  writeFileSync(certPath, content, "utf-8");
  return certPath;
}

/**
 * Collect CA certificates from explicit sources, deduplicate, and return as a single PEM string.
 *
 * Sources (in order):
 * 1. User-specified PEM file path (from config `caCert`)
 * 2. NODE_EXTRA_CA_CERTS environment variable
 */
export function collectCACerts(configCertPath?: string): string {
  const allBlocks: string[] = [];

  // 1. User-specified cert path
  if (configCertPath) {
    try {
      const content = readFileSync(configCertPath, "utf-8");
      allBlocks.push(...parsePemBlocks(content));
    } catch {
      // file not found or unreadable — skip
    }
  }

  // 2. NODE_EXTRA_CA_CERTS
  const extraCaPath = process.env.NODE_EXTRA_CA_CERTS;
  if (extraCaPath) {
    try {
      const content = readFileSync(extraCaPath, "utf-8");
      allBlocks.push(...parsePemBlocks(content));
    } catch {
      // skip
    }
  }

  if (allBlocks.length === 0) return "";

  // Deduplicate by cert content
  const unique = [...new Set(allBlocks)];
  return unique.join("\n") + "\n";
}
