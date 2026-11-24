import { describe, expect, it } from "vitest";

import {
  decodeBase32,
  encodeBase32,
  generateTotpCode,
  generateTotpSecret,
  totpStepForDate,
  verifyTotpCode,
} from "@/lib/auth/totp";

// RFC 6238 test secret: the ASCII string "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const RFC_VECTORS = [
  { seconds: 59, code: "287082" },
  { seconds: 1111111109, code: "081804" },
  { seconds: 1111111111, code: "050471" },
  { seconds: 1234567890, code: "005924" },
  { seconds: 2000000000, code: "279037" },
  { seconds: 20000000000, code: "353130" },
];

describe("RFC 6238 TOTP", () => {
  it("matches the published SHA-1 test vectors at six digits", () => {
    for (const vector of RFC_VECTORS) {
      const step = Math.floor(vector.seconds / 30);
      expect(generateTotpCode(RFC_SECRET, step)).toBe(vector.code);

      const verification = verifyTotpCode(RFC_SECRET, vector.code, {
        now: new Date(vector.seconds * 1000),
        window: 0,
      });
      expect(verification).toEqual({ valid: true, step });
    }
  });

  it("round-trips base32 and accepts lowercase or grouped input", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    expect(encodeBase32(bytes)).toBe(RFC_SECRET);
    expect(decodeBase32(RFC_SECRET).toString("ascii")).toBe(
      "12345678901234567890",
    );
    expect(
      decodeBase32(RFC_SECRET.toLowerCase().replace(/(.{4})/g, "$1 ")),
    ).toEqual(bytes);
  });

  it("generates a 20-byte secret in base32", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(decodeBase32(secret)).toHaveLength(20);
  });

  it("accepts one adjacent time step by default and rejects it with a zero window", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const previousCode = generateTotpCode(
      RFC_SECRET,
      totpStepForDate(now) - 1,
    );

    expect(verifyTotpCode(RFC_SECRET, previousCode, { now })).toEqual({
      valid: true,
      step: totpStepForDate(now) - 1,
    });
    expect(
      verifyTotpCode(RFC_SECRET, previousCode, { now, window: 0 }),
    ).toEqual({ valid: false, reason: "invalid" });
  });

  it("rejects a code at or below the last accepted step", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const step = totpStepForDate(now);
    const code = generateTotpCode(RFC_SECRET, step);

    expect(
      verifyTotpCode(RFC_SECRET, code, {
        now,
        lastUsedStep: step - 1,
      }),
    ).toEqual({ valid: true, step });
    expect(
      verifyTotpCode(RFC_SECRET, code, {
        now,
        lastUsedStep: step,
      }),
    ).toEqual({ valid: false, reason: "replay" });
    expect(
      verifyTotpCode(RFC_SECRET, code, {
        now,
        lastUsedStep: step + 1,
      }),
    ).toEqual({ valid: false, reason: "replay" });
  });

  it("rejects malformed and incorrect codes", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(verifyTotpCode(RFC_SECRET, "12345", { now })).toEqual({
      valid: false,
      reason: "invalid",
    });
    expect(verifyTotpCode(RFC_SECRET, "abcdef", { now })).toEqual({
      valid: false,
      reason: "invalid",
    });
    expect(verifyTotpCode(RFC_SECRET, "000000", { now })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });
});
