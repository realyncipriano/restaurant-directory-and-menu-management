import { describe, expect, it } from "vitest";

import { resolveRestoreTarget } from "../../scripts/lib/restore-target";

const PROD_POOLED =
  "postgresql://user:pass@ep-prod-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const PROD_DIRECT =
  "postgresql://user:pass@ep-prod-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const TEST_DATABASE =
  "postgresql://user:pass@ep-test-456.ap-southeast-1.aws.neon.tech/rdmm_test?sslmode=require";
const RESTORE_DATABASE =
  "postgresql://user:pass@ep-restore-789.ap-southeast-1.aws.neon.tech/rdmm_restore?sslmode=require";

function baseEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: PROD_POOLED,
    DATABASE_URL_DIRECT: PROD_DIRECT,
    TEST_DATABASE_URL: TEST_DATABASE,
    RESTORE_CONFIRM: "RESTORE",
    ALLOW_DESTRUCTIVE_DB_TESTS: "1",
    RESTORE_DATABASE_URL: RESTORE_DATABASE,
    ...overrides,
  };
}

describe("restore target guard", () => {
  it("accepts a distinct direct restore target", () => {
    expect(resolveRestoreTarget(baseEnv())).toBe(RESTORE_DATABASE);
    expect(
      resolveRestoreTarget(
        baseEnv({ RESTORE_DATABASE_URL: `  ${RESTORE_DATABASE}  ` }),
      ),
    ).toBe(RESTORE_DATABASE);
  });

  it("requires both confirmation flags and a target URL", () => {
    expect(() =>
      resolveRestoreTarget(baseEnv({ RESTORE_CONFIRM: "restore" })),
    ).toThrow(/RESTORE_CONFIRM=RESTORE/u);
    expect(() => resolveRestoreTarget(baseEnv({ RESTORE_CONFIRM: "" }))).toThrow(
      /RESTORE_CONFIRM=RESTORE/u,
    );
    expect(() =>
      resolveRestoreTarget(baseEnv({ ALLOW_DESTRUCTIVE_DB_TESTS: "" })),
    ).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS=1/u);
    expect(() =>
      resolveRestoreTarget(baseEnv({ RESTORE_DATABASE_URL: "" })),
    ).toThrow(/RESTORE_DATABASE_URL is not set/u);
  });

  it("rejects invalid target URLs and unsafe Neon hostnames", () => {
    expect(() =>
      resolveRestoreTarget(
        baseEnv({ RESTORE_DATABASE_URL: "mysql://user:pass@host/db" }),
      ),
    ).toThrow(/invalid/u);
    expect(() =>
      resolveRestoreTarget(
        baseEnv({
          RESTORE_DATABASE_URL:
            "postgresql://user:pass@ep-restore.neon.tech/db?sslmode=require",
        }),
      ),
    ).toThrow(/cannot be compared safely/u);
  });

  it("rejects a pooled Neon target", () => {
    expect(() =>
      resolveRestoreTarget(
        baseEnv({
          RESTORE_DATABASE_URL:
            "postgresql://user:pass@ep-restore-789-pooler.ap-southeast-1.aws.neon.tech/rdmm_restore?sslmode=require",
        }),
      ),
    ).toThrow(/direct \(non-pooled\)/u);
  });

  it("rejects targets that match the application or test database", () => {
    expect(() =>
      resolveRestoreTarget(baseEnv({ RESTORE_DATABASE_URL: PROD_DIRECT })),
    ).toThrow(/protected database/u);
    expect(() =>
      resolveRestoreTarget(baseEnv({ RESTORE_DATABASE_URL: PROD_POOLED })),
    ).toThrow(/non-pooled|protected database/u);
    expect(() =>
      resolveRestoreTarget(baseEnv({ RESTORE_DATABASE_URL: TEST_DATABASE })),
    ).toThrow(/protected database/u);
  });

  it("fails closed when a protected URL cannot be compared", () => {
    expect(() =>
      resolveRestoreTarget(
        baseEnv({ DEV_DATABASE_URLS: "not-a-connection-string" }),
      ),
    ).toThrow(/development or test database URL is invalid/u);

    expect(() =>
      resolveRestoreTarget(
        baseEnv({
          DATABASE_URL:
            "postgresql://user:pass@ep-prod.neon.tech/neondb?sslmode=require",
        }),
      ),
    ).toThrow(/cannot be compared safely/u);
  });

  it("accepts a distinct non-Neon target", () => {
    const target =
      "postgresql://user:pass@restore.internal.example.com/rdmm_restore?sslmode=require";
    expect(
      resolveRestoreTarget(baseEnv({ RESTORE_DATABASE_URL: target })),
    ).toBe(target);
  });
});
