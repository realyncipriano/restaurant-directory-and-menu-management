import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const vitestEntry = fileURLToPath(
  new URL("../../node_modules/vitest/vitest.mjs", import.meta.url),
);

const UNSAFE_TEST_URL =
  "postgresql://guard-user:super-secret-password@127.0.0.1:1/rdmm_guard_dev";

function runDirectIntegrationVitest(
  overrides: Record<string, string>,
): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) {
      delete env[key];
    }
  }
  for (const key of [
    "TEST_DATABASE_URL",
    "ALLOW_DESTRUCTIVE_DB_TESTS",
    "DEV_DATABASE_URLS",
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "NEON_BRANCH_URL_POOLED",
    "NEON_BRANCH_URL_DIRECT",
  ]) {
    delete env[key];
  }
  Object.assign(env, overrides);

  return spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      "--config",
      "vitest.config.mts",
      "--reporter=verbose",
      "tests/integration/concurrency.test.ts",
    ],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    },
  );
}

function outputOf(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const DIRECT_DEV_URL =
  "postgresql://dev-user:dev-secret@dev-guard.invalid/rdmm_guard_dev";
const DIRECT_NEON_DEV_URL =
  "postgresql://dev-user:dev-secret@ep-guard-123456.us-east-2.aws.neon.tech/rdmm_guard_dev";

function expectBlockedBeforeConnect(
  overrides: Record<string, string>,
  expectedReason: string,
): void {
  const result = runDirectIntegrationVitest(overrides);

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  const output = outputOf(result);
  expect(output).toContain("Refusing destructive database operation");
  expect(output).toContain(expectedReason);
  expect(output).not.toContain("Migrations applied");
  expect(output).not.toContain("getaddrinfo");
  expect(output).not.toContain("ECONNREFUSED");
  expect(output).not.toContain("dev-secret");
  expect(output).not.toContain("test-secret");
}

describe("direct Vitest integration guard", () => {
  it("fails before database work when TEST_DATABASE_URL is missing", () => {
    const result = runDirectIntegrationVitest({
      // An explicit empty value prevents any local .env file from supplying a
      // target while still exercising the missing-URL guard.
      TEST_DATABASE_URL: "",
      ALLOW_DESTRUCTIVE_DB_TESTS: "1",
      DEV_DATABASE_URLS:
        "postgresql://dev-user:dev-password@127.0.0.1:1/rdmm_dev",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const output = outputOf(result);
    expect(output).toContain("Refusing destructive database operation");
    expect(output).toContain("TEST_DATABASE_URL is not set");
    expect(output).not.toContain("ECONNREFUSED");
  });

  it("fails before connecting when TEST_DATABASE_URL is a development target", () => {
    const result = runDirectIntegrationVitest({
      TEST_DATABASE_URL: UNSAFE_TEST_URL,
      ALLOW_DESTRUCTIVE_DB_TESTS: "1",
      DEV_DATABASE_URLS: UNSAFE_TEST_URL,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const output = outputOf(result);
    expect(output).toContain("Refusing destructive database operation");
    expect(output).toContain("points at the development database");
    expect(output).toContain("127.0.0.1/rdmm_guard_dev");
    expect(output).not.toContain("super-secret-password");
    expect(output).not.toContain("ECONNREFUSED");
  });

  it("fails before connecting for a trailing-dot development hostname", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@dev-guard.invalid./rdmm_guard_dev",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS: DIRECT_DEV_URL,
      },
      "points at the development database",
    );
  });

  it("fails before connecting for a pooled Neon endpoint matching the direct development endpoint", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@ep-guard-123456-pooler.us-east-2.aws.neon.tech/rdmm_guard_dev",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS: DIRECT_NEON_DEV_URL,
      },
      "points at the development database",
    );
  });

  it("fails before connecting for an equivalent percent-encoded database name", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@dev-guard.invalid/rdmm_guard%5Fdev",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS: DIRECT_DEV_URL,
      },
      "points at the development database",
    );
  });

  it("fails before connecting for an IPv4 shorthand alias of the development host", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@127.1/rdmm_guard_dev",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS:
          "postgresql://dev-user:dev-secret@127.0.0.1/rdmm_guard_dev",
      },
      "points at the development database",
    );
  });

  it("fails before connecting when the query string overrides the host", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@test-guard.invalid/rdmm_guard_dev?host=dev-guard.invalid",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS: DIRECT_DEV_URL,
      },
      "must not override",
    );
  });

  it("fails before connecting for a double-encoded database name matching development", () => {
    expectBlockedBeforeConnect(
      {
        TEST_DATABASE_URL:
          "postgresql://test-user:test-secret@dev-guard.invalid/rdmm_guard%255Fdev",
        ALLOW_DESTRUCTIVE_DB_TESTS: "1",
        DEV_DATABASE_URLS: DIRECT_DEV_URL,
      },
      "points at the development database",
    );
  });
});
