import { describe, expect, it } from "vitest";

import {
  assertSafeTestTarget,
  canonicalDatabaseIdentity,
  collectDevUrls,
  evaluateTestTarget,
  maskConnectionString,
  parseConnectionTarget,
} from "@/db/safety";

const DEV_URL =
  "postgresql://user:pass@dev-host.example.com/neondb?sslmode=require";
const TEST_URL =
  "postgresql://user:pass@test-host.example.com/neondb?sslmode=require";

const NEON_DEV_DIRECT =
  "postgresql://user:pass@ep-dev-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const NEON_DEV_POOLED =
  "postgresql://user:pass@ep-dev-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const NEON_TEST_DIRECT =
  "postgresql://user:pass@ep-test-654321.us-east-2.aws.neon.tech/neondb?sslmode=require";

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
      host: "dev-host.example.com",
      database: "neondb",
    });
    expect(maskConnectionString(DEV_URL)).toBe(
      "dev-host.example.com/neondb",
    );
  });

  it("normalizes hostname case, trailing dots, and encoded database names", () => {
    expect(
      parseConnectionTarget(
        "postgresql://user:pass@DEV-HOST.EXAMPLE.COM./neon%64b",
      ),
    ).toEqual({
      host: "dev-host.example.com",
      database: "neondb",
    });
  });

  it.each([
    ["127.1", "127.0.0.1"],
    ["127.000.000.001", "127.0.0.1"],
    ["2130706433", "127.0.0.1"],
    ["0x7f000001", "127.0.0.1"],
    ["0177.0.0.1", "127.0.0.1"],
  ])(
    "canonicalizes the IPv4 literal %s the way the driver does",
    (host, expected) => {
      expect(
        parseConnectionTarget(`postgresql://user:pass@${host}/neondb`).host,
      ).toBe(expected);
    },
  );

  it("matches the driver's two-stage database-name decoding", () => {
    expect(
      parseConnectionTarget(
        "postgresql://user:pass@dev-host.example.com/db%255Fname",
      ).database,
    ).toBe("db_name");
    expect(
      parseConnectionTarget(
        "postgresql://user:pass@dev-host.example.com/db%2520name",
      ).database,
    ).toBe("db name");
  });

  it("canonicalizes pooled and direct Neon endpoint hosts identically", () => {
    const direct = canonicalDatabaseIdentity(NEON_DEV_DIRECT);
    const pooled = canonicalDatabaseIdentity(NEON_DEV_POOLED);

    expect(direct.hostIdentity).toMatchObject({
      kind: "neon",
      endpointId: "ep-dev-123456",
      region: "us-east-2.aws",
      pooled: false,
    });
    expect(pooled.hostIdentity).toMatchObject({
      kind: "neon",
      endpointId: "ep-dev-123456",
      region: "us-east-2.aws",
      pooled: true,
    });
    expect(pooled.identity).toBe(direct.identity);
    expect(pooled.identity).toBe("neon:ep-dev-123456|us-east-2.aws|db:neondb");
  });

  it("keeps different Neon endpoint IDs distinct", () => {
    const dev = canonicalDatabaseIdentity(NEON_DEV_DIRECT);
    const test = canonicalDatabaseIdentity(NEON_TEST_DIRECT);

    expect(dev.identity).not.toBe(test.identity);
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

  it("blocks a trailing-dot hostname that matches the development host", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@dev-host.example.com./neondb?sslmode=require",
      }),
    );
    expect(result.safe).toBe(false);
  });

  it("blocks an uppercase hostname that matches the development host", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@DEV-HOST.EXAMPLE.COM/neondb?sslmode=require",
      }),
    );
    expect(result.safe).toBe(false);
  });

  it("blocks a pooled test host against its direct development endpoint", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: NEON_DEV_DIRECT,
        DATABASE_URL_DIRECT: NEON_DEV_DIRECT,
        TEST_DATABASE_URL: NEON_DEV_POOLED,
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain(
        "ep-dev-123456-pooler.us-east-2.aws.neon.tech/neondb",
      );
    }
  });

  it("blocks a direct test host against its pooled development endpoint", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: NEON_DEV_POOLED,
        DATABASE_URL_DIRECT: NEON_DEV_DIRECT,
        TEST_DATABASE_URL: NEON_DEV_DIRECT,
      }),
    );
    expect(result.safe).toBe(false);
  });

  it("blocks a percent-encoded database name that matches development", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@dev-host.example.com/neon%64b?sslmode=require",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("development database");
    }
  });

  it("blocks an IPv4 shorthand alias that reaches the development host", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: "postgresql://user:pass@127.0.0.1/rdmm_dev",
        DATABASE_URL_DIRECT: "postgresql://user:pass@127.0.0.1/rdmm_dev",
        TEST_DATABASE_URL: "postgresql://user:pass@127.1/rdmm_dev",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("development database");
    }
  });

  it("blocks a double-encoded database name that decodes to the development database", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: "postgresql://user:pass@127.0.0.1/rdmm%2520dev",
        DATABASE_URL_DIRECT:
          "postgresql://user:pass@127.0.0.1/rdmm%2520dev",
        TEST_DATABASE_URL: "postgresql://user:pass@127.1/rdmm%20dev",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("development database");
    }
  });

  it.each(["host", "hostaddr"])(
    "rejects a %s query parameter that would override the target",
    (param) => {
      const result = evaluateTestTarget(
        env({
          TEST_DATABASE_URL: `postgresql://user:pass@test-host.example.com/neondb?${param}=dev-host.example.com`,
        }),
      );
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.reason).toContain("must not override");
      }
    },
  );

  it("rejects a development URL with a host query parameter", () => {
    const result = evaluateTestTarget(
      env({
        DEV_DATABASE_URLS:
          "postgresql://user:pass@dev-host.example.com/neondb?host=other-host.example.com",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("invalid");
    }
  });

  it("blocks the same host and database even when the port differs", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL:
          "postgresql://user:pass@dev-host.example.com:5432/neondb",
        DATABASE_URL_DIRECT:
          "postgresql://user:pass@dev-host.example.com:5432/neondb",
        TEST_DATABASE_URL:
          "postgresql://user:pass@dev-host.example.com:5433/neondb",
      }),
    );
    expect(result.safe).toBe(false);
  });

  it("blocks malformed percent encoding in the database name", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@test-host.example.com/neon%ZZ",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("malformed percent encoding");
    }
  });

  it("blocks incomplete Neon endpoint configuration", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL:
          "postgresql://user:pass@dev-host.neon.tech/neondb?sslmode=require",
        DATABASE_URL_DIRECT:
          "postgresql://user:pass@dev-host.neon.tech/neondb?sslmode=require",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("Neon");
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
        host: "test-host.example.com",
        database: "neondb",
      });
    }
  });

  it("allows a separate database on the same host", () => {
    const result = evaluateTestTarget(
      env({
        TEST_DATABASE_URL:
          "postgresql://user:pass@dev-host.example.com/rdmm_test?sslmode=require",
      }),
    );
    expect(result.safe).toBe(true);
  });

  it("allows a separate Neon endpoint with the same database name", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: NEON_DEV_POOLED,
        DATABASE_URL_DIRECT: NEON_DEV_DIRECT,
        TEST_DATABASE_URL: NEON_TEST_DIRECT,
      }),
    );
    expect(result.safe).toBe(true);
  });

  it("allows a different database on the same Neon endpoint", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: NEON_DEV_DIRECT,
        DATABASE_URL_DIRECT: NEON_DEV_DIRECT,
        TEST_DATABASE_URL:
          "postgresql://user:pass@ep-dev-123456.us-east-2.aws.neon.tech/rdmm_test?sslmode=require",
      }),
    );
    expect(result.safe).toBe(true);
  });

  it("allows a genuinely separate disposable PostgreSQL database", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL:
          "postgresql://user:pass@127.0.0.1:5432/rdmm_dev?sslmode=disable",
        DATABASE_URL_DIRECT:
          "postgresql://user:pass@127.0.0.1:5432/rdmm_dev?sslmode=disable",
        TEST_DATABASE_URL:
          "postgresql://user:pass@127.0.0.2:5432/rdmm_test?sslmode=disable",
      }),
    );
    expect(result.safe).toBe(true);
  });

  it("blocks when any configured development URL matches the test target", () => {
    const result = evaluateTestTarget(
      env({
        DATABASE_URL: undefined,
        DATABASE_URL_DIRECT: undefined,
        DEV_DATABASE_URLS: `postgresql://user:pass@other-dev.example.com/neondb,${DEV_URL}`,
        TEST_DATABASE_URL: DEV_URL,
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("development database");
      expect(result.reason).not.toContain("user");
      expect(result.reason).not.toContain("pass");
    }
  });

  it("blocks when a configured development URL is invalid", () => {
    const result = evaluateTestTarget(
      env({ DEV_DATABASE_URLS: "not-a-database-url" }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("invalid");
    }
  });

  it("blocks when a configured development database name is malformed", () => {
    const result = evaluateTestTarget(
      env({
        DEV_DATABASE_URLS:
          "postgresql://user:pass@other-dev.example.com/neon%ZZ",
      }),
    );
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("invalid");
    }
  });

  it("collects every configured comparison URL", () => {
    const urls = collectDevUrls({
      DATABASE_URL: "postgresql://user:pass@one.example/neondb",
      DATABASE_URL_DIRECT: "postgresql://user:pass@two.example/neondb",
      NEON_BRANCH_URL_POOLED: "postgresql://user:pass@three.example/neondb",
      NEON_BRANCH_URL_DIRECT: "postgresql://user:pass@four.example/neondb",
      DEV_DATABASE_URLS:
        "postgresql://user:pass@five.example/neondb, postgresql://user:pass@six.example/neondb",
    });
    expect(urls).toHaveLength(6);
  });

  it("asserts a safe target before any connection can be attempted", () => {
    expect(() =>
      assertSafeTestTarget(env({ TEST_DATABASE_URL: undefined })),
    ).toThrow(/TEST_DATABASE_URL/);
    expect(() =>
      assertSafeTestTarget(env({ TEST_DATABASE_URL: DEV_URL })),
    ).toThrow(/development database/);
  });
});
