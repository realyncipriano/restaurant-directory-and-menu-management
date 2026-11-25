import {
  canonicalDatabaseIdentity,
  collectDevUrls,
  maskConnectionString,
} from "../../src/db/safety";

/**
 * Resolves RESTORE_DATABASE_URL and refuses any target that is not a fresh,
 * direct, clearly separate database. This is the last guard before a
 * destructive restore; it must fail closed.
 */
export function resolveRestoreTarget(
  env: Record<string, string | undefined>,
): string {
  if (env.RESTORE_CONFIRM !== "RESTORE") {
    throw new Error(
      "Refusing to restore: set RESTORE_CONFIRM=RESTORE to confirm this destructive operation.",
    );
  }
  if (env.ALLOW_DESTRUCTIVE_DB_TESTS !== "1") {
    throw new Error(
      "Refusing to restore: set ALLOW_DESTRUCTIVE_DB_TESTS=1 to acknowledge that the target database is disposable.",
    );
  }

  const targetUrl = env.RESTORE_DATABASE_URL?.trim();
  if (!targetUrl) {
    throw new Error(
      "RESTORE_DATABASE_URL is not set. Point it at a fresh, migrated database or Neon branch.",
    );
  }

  let target: ReturnType<typeof canonicalDatabaseIdentity>;
  try {
    target = canonicalDatabaseIdentity(targetUrl);
  } catch (error) {
    throw new Error(
      `RESTORE_DATABASE_URL is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (target.identity === null) {
    throw new Error(
      "RESTORE_DATABASE_URL uses a Neon hostname that cannot be compared safely.",
    );
  }
  if (target.hostIdentity.kind === "neon" && target.hostIdentity.pooled) {
    throw new Error(
      "RESTORE_DATABASE_URL must use the direct (non-pooled) Neon endpoint.",
    );
  }

  const protectedUrls = [
    ...collectDevUrls(env),
    env.TEST_DATABASE_URL?.trim() ?? "",
  ].filter((value): value is string => Boolean(value));

  for (const protectedUrl of protectedUrls) {
    let protectedIdentity: ReturnType<typeof canonicalDatabaseIdentity>;
    try {
      protectedIdentity = canonicalDatabaseIdentity(protectedUrl);
    } catch {
      throw new Error(
        "A configured development or test database URL is invalid. Refusing to restore.",
      );
    }
    if (protectedIdentity.identity === null) {
      throw new Error(
        "A configured development or test database URL cannot be compared safely. Refusing to restore.",
      );
    }
    if (protectedIdentity.identity === target.identity) {
      throw new Error(
        `RESTORE_DATABASE_URL points at a protected database (${maskConnectionString(protectedUrl)}). Use a fresh Neon branch or database.`,
      );
    }
  }

  return targetUrl;
}
