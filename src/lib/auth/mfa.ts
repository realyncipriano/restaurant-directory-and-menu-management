import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { getAppName, getMfaEncryptionKey } from "@/lib/env";

import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  generateTotpSecret,
} from "./totp";

/**
 * MFA secret protection and recovery-code helpers.
 *
 * TOTP secrets are encrypted with AES-256-GCM so a database read alone does not
 * expose an authenticator seed. Recovery codes are stored as keyed hashes.
 */

export const MFA_RECOVERY_CODE_COUNT = 10;

const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CODE_LENGTH = 12;
const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(`rdmm:mfa:encryption:v1:${getMfaEncryptionKey()}`)
    .digest();
}

function recoveryPepper(): Buffer {
  return createHash("sha256")
    .update(`rdmm:mfa:recovery:v1:${getMfaEncryptionKey()}`)
    .digest();
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error("MFA secret has an unsupported format.");
  }

  const iv = Buffer.from(parts[1]!, "base64url");
  const authTag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("MFA secret is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function generateRecoveryCodes(
  count = MFA_RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();

  while (codes.size < count) {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    let code = "";
    for (const byte of bytes) {
      code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    codes.add(code.match(/.{4}/gu)!.join("-"));
  }

  return [...codes];
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/gu, "")
    .replace(/O/gu, "0")
    .replace(/[IL]/gu, "1");
}

export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", recoveryPepper())
    .update(`recovery:${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

export function buildTotpProvisioningUri(
  email: string,
  secret: string,
  issuer = getAppName(),
): string {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export { generateTotpSecret };
