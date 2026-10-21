export type DbTarget = {
  host: string;
  database: string;
};

export type TestTargetEvaluation =
  | { safe: true; target: DbTarget; connectionString: string }
  | { safe: false; reason: string };

export function parseConnectionTarget(connectionString: string): DbTarget {
  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (!url.hostname || !database) {
    throw new Error("Database connection string must include a host and database name.");
  }
  return {
    host: url.hostname.toLowerCase(),
    database: database.toLowerCase(),
  };
}

export function maskConnectionString(connectionString: string): string {
  const target = parseConnectionTarget(connectionString);
  return `${target.host}/${target.database}`;
}

export function collectDevUrls(
  env: Record<string, string | undefined>,
): string[] {
  const values = [
    env.DATABASE_URL,
    env.DATABASE_URL_DIRECT,
    env.NEON_BRANCH_URL_POOLED,
    env.NEON_BRANCH_URL_DIRECT,
    ...(env.DEV_DATABASE_URLS ?? "").split(","),
  ];

  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function evaluateTestTarget(
  env: Record<string, string | undefined>,
): TestTargetEvaluation {
  const testUrl = env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    return {
      safe: false,
      reason:
        "TEST_DATABASE_URL is not set. Destructive tests require a dedicated disposable database.",
    };
  }

  if (env.ALLOW_DESTRUCTIVE_DB_TESTS !== "1") {
    return {
      safe: false,
      reason:
        "ALLOW_DESTRUCTIVE_DB_TESTS must be set to 1 to run destructive integration tests.",
    };
  }

  let target: DbTarget;
  try {
    target = parseConnectionTarget(testUrl);
  } catch (error) {
    return {
      safe: false,
      reason: error instanceof Error ? error.message : "Invalid TEST_DATABASE_URL.",
    };
  }

  const devUrls = collectDevUrls(env);
  if (devUrls.length === 0) {
    return {
      safe: false,
      reason:
        "No development database URLs are configured for comparison. Refusing to run destructive tests.",
    };
  }

  for (const devUrl of devUrls) {
    let devTarget: DbTarget;
    try {
      devTarget = parseConnectionTarget(devUrl);
    } catch {
      continue;
    }
    if (
      devTarget.host === target.host &&
      devTarget.database === target.database
    ) {
      return {
        safe: false,
        reason: `TEST_DATABASE_URL points at the development database (${target.host}/${target.database}). Use a separate Neon branch or database.`,
      };
    }
  }

  return { safe: true, target, connectionString: testUrl };
}

export function assertDestructiveTestTarget(
  env: Record<string, string | undefined>,
): string {
  const result = evaluateTestTarget(env);
  if (!result.safe) {
    throw new Error(`Refusing destructive database operation: ${result.reason}`);
  }
  return result.connectionString;
}
