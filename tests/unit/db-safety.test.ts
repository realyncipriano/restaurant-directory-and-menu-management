import { describe, expect, it } from "vitest";

import {
  evaluateTestTarget,
  maskConnectionString,
  parseConnectionTarget,
} from "@/db/safety";

const DEV_URL =
  "postgresql://user:pass@dev-host.neon.tech/neondb?sslmode=require";
const TEST_URL =
  "postgresql://user:pass@test-host.neon.tech/neondb?sslmode=require";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: DEV_URL,
    DATABASE_URL_DIRECT: DEV_URL,
    TEST_DATABASE_URL: TEST_URL,
    ALLOW_DESTRUCTIVE_DB_TESTS: "1",
    ...overrides,
  };
}

describe("database target safety", () => {
  it("parses host and database without exposing credentials", () => {
    expect(parseConnectionTarget(DEV_URL)).toEqual({
      host: "dev-host.neon.tech",
      database: "neondb",
    });
    expect(maskConnectionString(DEV_URL)).toBe("dev-host.neon.tech/neondb");
  });

  it("blocks when TEST_DATABASE_URL is missing", () => {
    const result = evaluateTestTarget(env({ TEST_DATABASE_URL: undefined }));
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("TEST_DATABASE_URL");
    }
  });

  it("blocks without the explicit destructive flag", () => {
    const result = evaluateTestTarget(
      env({ ALLOW_DESTRUCTIVE_DB_TESTS: undefined }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("ALLOW_DESTRUCTIVE_DB_TESTS");
    }
  });

  it("blocks when the test target equals the development database", () => {
    const result = evaluateTestTarget(env({ TEST_DATABASE_URL: DEV_URL }));
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("development database");
    }
  });

  it("blocks when no development URLs are available for comparison", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: undefined,
        DATABASE_URL_DIRECT: undefined,
        NEON_BRANCH_URL_DIRECT: undefined,
        NEON_BRANCH_URL_POOLED: undefined,
      }),
    );
    expect(result.safe).toBe(false);
  });

  it("allows a separate host and database", () => {
    const result = evaluateTestTarget(env());
    expect(result.safe).toBe(true);
    if (result.safe) {
      expect(result.target).toEqual({
        host: "test-host.neon.tech",
        database: "neondb",
      });
    }
  });

  it("allows a separate database on the same host", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@dev-host.neon.tech/rdmm_test?sslmode=require",
      }),
    );
    expect(result.safe).toBe(true);
  });

  it("allows a separate branch host with the same database name", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@ep-test-branch.neon.tech/neondb?sslmode=require",
      }),
    );
    expect(result.safe).toBe(true);
  });
});
