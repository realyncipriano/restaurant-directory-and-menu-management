function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getConnectionUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const url =
    clean(env.DATABASE_URL) ?? clean(env.NEON_BRANCH_URL_POOLED);
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in .env.local or the environment.",
    );
  }
  return url;
}

export function getDirectDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url =
    clean(env.DATABASE_URL_DIRECT) ?? clean(env.NEON_BRANCH_URL_DIRECT);
  return url ?? getConnectionUrlFromEnv(env);
}
