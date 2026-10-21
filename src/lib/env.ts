import "server-only";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
  endpoint: string;
};

export type ExtractionConfig = {
  provider: "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxPages: number;
  timeoutMs: number;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isTestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function requireSafeTestUrl(): string {
  const testUrl = clean(process.env.TEST_DATABASE_URL);
  if (!testUrl) {
    throw new Error(
      "Integration tests require an explicitly configured TEST_DATABASE_URL pointing at a dedicated disposable database.",
    );
  }

  const devUrls = (process.env.DEV_DATABASE_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (devUrls.length === 0) {
    throw new Error(
      "Refusing to use a test database without DEV_DATABASE_URLS set for comparison. Run tests through npm run test:integration.",
    );
  }

  const target = parseDbTarget(testUrl);
  for (const devUrl of devUrls) {
    const devTarget = parseDbTarget(devUrl);
    if (target.host === devTarget.host && target.database === devTarget.database) {
      throw new Error(
        `Refusing to use the development database as a test target (${target.host}/${target.database}).`,
      );
    }
  }

  return testUrl;
}

export function parseDbTarget(connectionString: string): {
  host: string;
  database: string;
} {
  const url = new URL(connectionString);
  return {
    host: url.hostname.toLowerCase(),
    database: url.pathname.replace(/^\//, "").toLowerCase(),
  };
}

export function getDatabaseUrl(): string {
  if (isTestRuntime()) {
    return requireSafeTestUrl();
  }

  const url =
    clean(process.env.DATABASE_URL) ?? clean(process.env.NEON_BRANCH_URL_POOLED);
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL (pooled Neon connection string) in .env.local.",
    );
  }
  return url;
}

export function getDirectDatabaseUrl(): string {
  const url =
    clean(process.env.DATABASE_URL_DIRECT) ??
    clean(process.env.NEON_BRANCH_URL_DIRECT);
  return url ?? getDatabaseUrl();
}

export function getAuthSecret(): string {
  const secret = clean(process.env.AUTH_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be configured with at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return secret;
}

export function getAppUrl(): string {
  const value = clean(process.env.APP_URL) ?? "http://localhost:3000";
  try {
    return new URL(value).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function getAppName(): string {
  return clean(process.env.NEXT_PUBLIC_APP_NAME) ?? "Menu Directory";
}

export function getR2Config(): R2Config | null {
  const accountId = clean(process.env.R2_ACCOUNT_ID);
  const accessKeyId = clean(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = clean(process.env.R2_BUCKET);

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  const endpoint =
    clean(process.env.R2_ENDPOINT) ??
    `https://${accountId}.r2.cloudflarestorage.com`;
  const publicBaseUrl = clean(process.env.R2_PUBLIC_BASE_URL) ?? null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl?.replace(/\/+$/, "") ?? null,
    endpoint,
  };
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

export function getExtractionConfig(): ExtractionConfig | null {
  const provider = clean(process.env.EXTRACTION_PROVIDER);
  if (!provider || provider === "disabled") {
    return null;
  }
  if (provider !== "openai") {
    throw new Error(
      `Unsupported EXTRACTION_PROVIDER "${provider}". Supported values: "openai" or "disabled".`,
    );
  }

  const apiKey = clean(process.env.EXTRACTION_API_KEY);
  if (!apiKey) {
    return null;
  }

  const baseUrl = (
    clean(process.env.EXTRACTION_BASE_URL) ?? "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const model = clean(process.env.EXTRACTION_MODEL) ?? "gpt-4o-mini";
  const maxPages = Number.parseInt(process.env.EXTRACTION_MAX_PAGES ?? "10", 10);
  const timeoutMs = Number.parseInt(
    process.env.EXTRACTION_TIMEOUT_MS ?? "90000",
    10,
  );

  return {
    provider: "openai",
    baseUrl,
    apiKey,
    model,
    maxPages: Number.isFinite(maxPages) ? Math.min(Math.max(maxPages, 1), 20) : 10,
    timeoutMs: Number.isFinite(timeoutMs)
      ? Math.min(Math.max(timeoutMs, 10_000), 180_000)
      : 90_000,
  };
}

export function isExtractionConfigured(): boolean {
  return getExtractionConfig() !== null;
}
