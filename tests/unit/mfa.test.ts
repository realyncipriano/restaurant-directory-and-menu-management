import { afterEach, describe, expect, it } from "vitest";

import {
  MFA_RECOVERY_CODE_COUNT,
  buildTotpProvisioningUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/auth/mfa";
import { isMfaRequiredForAdmins } from "@/lib/env";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

afterEach(() => {
  delete process.env.MFA_ENCRYPTION_KEY;
  delete process.env.MFA_REQUIRED_FOR_ADMINS;
});

describe("MFA secret encryption", () => {
  it("round-trips the TOTP secret with AES-256-GCM", () => {
    const encrypted = encryptTotpSecret(SECRET);

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(SECRET);
    expect(decryptTotpSecret(encrypted)).toBe(SECRET);
    expect(encryptTotpSecret(SECRET)).not.toBe(encrypted);
  });

  it("rejects tampered ciphertext and malformed payloads", () => {
    const encrypted = encryptTotpSecret(SECRET);
    const parts = encrypted.split(".");
    const ciphertext = parts[3]!;
    parts[3] = `${ciphertext.slice(0, -1)}${
      ciphertext.endsWith("A") ? "B" : "A"
    }`;

    expect(() => decryptTotpSecret(parts.join("."))).toThrow();
    expect(() => decryptTotpSecret("v1.bad")).toThrow();
    expect(() => decryptTotpSecret("")).toThrow();
  });

  it("uses a dedicated key and fails to decrypt after it changes", () => {
    process.env.MFA_ENCRYPTION_KEY = "a".repeat(32);
    const encrypted = encryptTotpSecret(SECRET);

    process.env.MFA_ENCRYPTION_KEY = "b".repeat(32);
    expect(() => decryptTotpSecret(encrypted)).toThrow();
  });

  it("rejects a short dedicated key", () => {
    process.env.MFA_ENCRYPTION_KEY = "too-short";
    expect(() => encryptTotpSecret(SECRET)).toThrow(/at least 32/);
  });
});

describe("recovery codes", () => {
  it("generates ten unique, grouped, high-entropy codes", () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(MFA_RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(normalizeRecoveryCode(code)).toHaveLength(12);
    }
  });

  it("normalizes case, separators, and ambiguous characters", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeRecoveryCode("O0I1L1")).toBe("001111");
    expect(normalizeRecoveryCode("  AB CD EF GH JK MN  ")).toBe(
      "ABCDEFGHJKMN",
    );
  });

  it("hashes deterministically and distinguishes codes", () => {
    const code = "ABCD-EFGH-JKMN";
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode("abcd efgh jkmn"));
    expect(hashRecoveryCode(code)).not.toBe(
      hashRecoveryCode("ABCD-EFGH-JKMP"),
    );
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("authenticator provisioning", () => {
  it("builds an otpauth URI without a third-party QR service", () => {
    const uri = buildTotpProvisioningUri(
      "admin@example.com",
      SECRET,
      "Menu Directory",
    );
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe("otpauth:");
    expect(parsed.host).toBe("totp");
    expect(decodeURIComponent(parsed.pathname)).toBe(
      "/Menu Directory:admin@example.com",
    );
    expect(parsed.searchParams.get("secret")).toBe(SECRET);
    expect(parsed.searchParams.get("issuer")).toBe("Menu Directory");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });

  it("keeps administrator MFA enforcement off by default", () => {
    expect(isMfaRequiredForAdmins()).toBe(false);
    for (const value of ["1", "true", "TRUE", "yes"]) {
      process.env.MFA_REQUIRED_FOR_ADMINS = value;
      expect(isMfaRequiredForAdmins()).toBe(true);
    }
    for (const value of ["0", "false", "no", ""]) {
      process.env.MFA_REQUIRED_FOR_ADMINS = value;
      expect(isMfaRequiredForAdmins()).toBe(false);
    }
  });
});
