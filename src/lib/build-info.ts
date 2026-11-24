const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

function firstDefined(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value && COMMIT_SHA_PATTERN.test(value)) {
      return value.toLowerCase();
    }
  }
  return null;
}

/**
 * Returns the exact source commit for the running deployment when the hosting
 * platform or build pipeline exposes it. The value is build metadata, not a
 * secret, and is safe to include in health responses and smoke reports.
 */
export function deploymentCommitSha(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return firstDefined(env, [
    "VERCEL_GIT_COMMIT_SHA",
    "GITHUB_SHA",
    "BUILD_COMMIT_SHA",
    "NEXT_PUBLIC_BUILD_SHA",
  ]);
}
