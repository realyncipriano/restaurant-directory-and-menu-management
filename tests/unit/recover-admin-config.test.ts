import { describe, expect, it } from "vitest";

import { readAdminRecoveryConfig } from "../../scripts/recover-admin-config";

const SECRET = "unit-test-recovery-secret-at-least-32-chars";

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    RECOVER_ADMIN_EMAIL: "Admin@Example.com",
    RECOVER_ADMIN_CONFIRM: "1",
    AUTH_SECRET: SECRET,
    APP_URL: "https://menus.example.com/some/path",
    ...overrides,
  };
}

describe("administrator recovery CLI configuration", () => {
  it("normalizes the email and app origin", () => {
    expect(readAdminRecoveryConfig(env())).toEqual({
      email: "admin@example.com",
      appUrl: "https://menus.example.com",
      authSecret: SECRET,
      allowDevelopmentUrl: false,
      disableMfa: false,
    });
  });

  it("only disables MFA with the explicit opt-in", () => {
    expect(readAdminRecoveryConfig(env()).disableMfa).toBe(false);
    expect(
      readAdminRecoveryConfig(env({ RECOVER_ADMIN_DISABLE_MFA: "1" }))
        .disableMfa,
    ).toBe(true);
    expect(
      readAdminRecoveryConfig(env({ RECOVER_ADMIN_DISABLE_MFA: "true" }))
        .disableMfa,
    ).toBe(false);
  });

  it.each([
    "RECOVER_ADMIN_EMAIL",
    "RECOVER_ADMIN_CONFIRM",
    "AUTH_SECRET",
    "APP_URL",
  ])("requires %s before connecting", (name) => {
    expect(() => readAdminRecoveryConfig(env({ [name]: undefined }))).toThrow(
      new RegExp(name),
    );
  });

  it("requires the explicit confirmation switch", () => {
    expect(() =>
      readAdminRecoveryConfig(env({ RECOVER_ADMIN_CONFIRM: "yes" })),
    ).toThrow(/RECOVER_ADMIN_CONFIRM=1/);
  });

  it("rejects invalid emails, short secrets, and invalid URLs", () => {
    expect(() =>
      readAdminRecoveryConfig(env({ RECOVER_ADMIN_EMAIL: "not-an-email" })),
    ).toThrow(/valid email/);
    expect(() =>
      readAdminRecoveryConfig(env({ AUTH_SECRET: "too-short" })),
    ).toThrow(/at least 32 characters/);
    expect(() =>
      readAdminRecoveryConfig(env({ APP_URL: "not-a-url" })),
    ).toThrow(/absolute URL/);
    expect(() =>
      readAdminRecoveryConfig(env({ APP_URL: "ftp://menus.example.com" })),
    ).toThrow(/http or https/);
  });

  it("never echoes the secret in validation errors", () => {
    let message = "";
    try {
      readAdminRecoveryConfig(
        env({ AUTH_SECRET: "short", APP_URL: "not-a-url" }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("short");
  });

  it("uses the production-safe URL policy by default", () => {
    expect(() =>
      readAdminRecoveryConfig(
        env({ APP_URL: "http://menus.example.com" }),
        "production",
      ),
    ).toThrow(/https/);
    expect(() =>
      readAdminRecoveryConfig(
        env({ APP_URL: "https://localhost:3000" }),
        "production",
      ),
    ).toThrow(/localhost or a private/);
    expect(() =>
      readAdminRecoveryConfig(
        env({ APP_URL: "https://127.0.0.1" }),
        "production",
      ),
    ).toThrow(/localhost or a private/);
    expect(() =>
      readAdminRecoveryConfig(
        env({ APP_URL: "https://[::1]" }),
        "production",
      ),
    ).toThrow(/localhost or a private/);
  });

  it("fails closed when NODE_ENV is missing or unexpected", () => {
    expect(
      readAdminRecoveryConfig(
        env({ NODE_ENV: undefined, APP_URL: "https://menus.example.com" }),
        undefined,
      ).appUrl,
    ).toBe("https://menus.example.com");

    expect(() =>
      readAdminRecoveryConfig(
        env({
          NODE_ENV: undefined,
          RECOVER_ADMIN_ALLOW_DEV_URL: "1",
          APP_URL: "http://localhost:3000",
        }),
        undefined,
      ),
    ).toThrow(/NODE_ENV is development or test/);

    expect(() =>
      readAdminRecoveryConfig(
        env({
          NODE_ENV: "staging",
          RECOVER_ADMIN_ALLOW_DEV_URL: "1",
          APP_URL: "http://localhost:3000",
        }),
        "staging",
      ),
    ).toThrow(/NODE_ENV is development or test/);
  });

  it("refuses the development opt-in in production", () => {
    expect(() =>
      readAdminRecoveryConfig(
        env({
          NODE_ENV: "production",
          RECOVER_ADMIN_ALLOW_DEV_URL: "1",
          APP_URL: "http://localhost:3000",
        }),
        "production",
      ),
    ).toThrow(/NODE_ENV is development or test/);
  });

  it("allows local HTTP URLs only with the explicit development opt-in", () => {
    expect(() =>
      readAdminRecoveryConfig(
        env({ APP_URL: "http://localhost:3000" }),
        "development",
      ),
    ).toThrow(/https/);

    expect(() =>
      readAdminRecoveryConfig(
        env({
          RECOVER_ADMIN_ALLOW_DEV_URL: "true",
          APP_URL: "http://localhost:3000",
        }),
        "development",
      ),
    ).toThrow(/https/);

    expect(
      readAdminRecoveryConfig(
        env({
          RECOVER_ADMIN_ALLOW_DEV_URL: "1",
          APP_URL: "http://localhost:3000",
        }),
        "development",
      ),
    ).toEqual({
      email: "admin@example.com",
      appUrl: "http://localhost:3000",
      authSecret: SECRET,
      allowDevelopmentUrl: true,
      disableMfa: false,
    });
  });

  it("allows the explicit development opt-in in the test environment", () => {
    expect(
      readAdminRecoveryConfig(
        env({
          NODE_ENV: "test",
          RECOVER_ADMIN_ALLOW_DEV_URL: "1",
          APP_URL: "http://[::1]:3000",
        }),
        "test",
      ).appUrl,
    ).toBe("http://[::1]:3000");
  });

  it("normalizes trailing-dot public hostnames", () => {
    expect(
      readAdminRecoveryConfig(
        env({ APP_URL: "https://menus.example.com./path" }),
        "production",
      ).appUrl,
    ).toBe("https://menus.example.com");
  });
});
