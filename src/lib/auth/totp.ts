import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP helpers.
 *
 * This module intentionally has no `server-only` dependency so scripts and
 * tests can generate and verify codes without the Next.js runtime.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DEFAULT_WINDOW = 1;

export type TotpVerification =
  | { valid: true; step: number }
  | { valid: false; reason: "invalid" | "replay" };

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function decodeBase32(input: string): Buffer {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/u, "");

  if (!normalized) {
    throw new Error("TOTP secret is empty.");
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error("TOTP secret is not valid base32.");
    }

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpStepForDate(date: Date): number {
  return Math.floor(date.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function generateTotpCode(secret: string, step: number): string {
  if (!Number.isSafeInteger(step) || step < 0) {
    throw new Error("TOTP step must be a non-negative integer.");
  }

  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * Verifies a TOTP code and enforces monotonic replay protection.
 *
 * `lastUsedStep` is the last accepted time step. Any matching code at or below
 * that step is rejected even if it is still inside the clock-skew window.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options: {
    now?: Date;
    window?: number;
    lastUsedStep?: number | null;
  } = {},
): TotpVerification {
  const normalized = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`, "u").test(normalized)) {
    return { valid: false, reason: "invalid" };
  }

  const now = options.now ?? new Date();
  const currentStep = totpStepForDate(now);
  const window = Math.min(
    Math.max(options.window ?? TOTP_DEFAULT_WINDOW, 0),
    10,
  );
  const lastUsedStep = options.lastUsedStep ?? null;
  let replay = false;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidateStep = currentStep + offset;
    if (candidateStep < 0) continue;

    const expected = generateTotpCode(secret, candidateStep);
    if (!constantTimeEqual(expected, normalized)) continue;

    if (lastUsedStep !== null && candidateStep <= lastUsedStep) {
      replay = true;
      continue;
    }

    return { valid: true, step: candidateStep };
  }

  return { valid: false, reason: replay ? "replay" : "invalid" };
}
