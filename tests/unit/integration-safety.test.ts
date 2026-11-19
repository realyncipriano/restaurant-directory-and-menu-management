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
});
