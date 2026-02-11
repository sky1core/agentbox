import { readFileSync } from "node:fs";
import { platform } from "node:os";
import { execCapture } from "../utils/process.js";

const PEM_BEGIN = "-----BEGIN CERTIFICATE-----";
const PEM_END = "-----END CERTIFICATE-----";

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
 * Detect CA certificates from macOS System Keychain.
 * Returns PEM-encoded certificates (empty string if none found or not macOS).
 *
 * Lima caCerts는 VM trust store에 "추가"하는 것이지 대체가 아니므로,
 * 기존 CA와 중복 주입되어도 무해하다 (redundant일 뿐).
 * 사내 프록시 CA가 System Keychain에 설치된 경우 zero-config로 동작.
 */
export function detectHostCACerts(): string {
  if (platform() !== "darwin") return "";

  try {
    const result = execCapture("security", [
      "find-certificate", "-a", "-p",
      "/Library/Keychains/System.keychain",
    ]);
    if (result.status !== 0 || !result.stdout.trim()) return "";
    return result.stdout;
  } catch {
    return "";
  }
}

/**
 * Collect CA certificates from all sources, deduplicate, and return as a single PEM string.
 *
 * Sources (in order):
 * 1. User-specified PEM file path (from config `caCert`)
 * 2. NODE_EXTRA_CA_CERTS environment variable
 * 3. macOS System Keychain auto-detect (zero-config 프록시 CA 지원)
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

  // 3. macOS System Keychain auto-detect
  const hostCerts = detectHostCACerts();
  if (hostCerts) {
    allBlocks.push(...parsePemBlocks(hostCerts));
  }

  if (allBlocks.length === 0) return "";

  // Deduplicate by cert content
  const unique = [...new Set(allBlocks)];
  return unique.join("\n") + "\n";
}
