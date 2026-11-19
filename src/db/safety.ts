import { isIP } from "node:net";

export type DbTarget = {
  host: string;
  database: string;
};

export type CanonicalHostIdentity =
  | {
      kind: "host";
      host: string;
      identity: string;
    }
  | {
      kind: "neon";
      endpointId: string;
      region: string;
      pooled: boolean;
      identity: string;
    }
  | {
      kind: "neon-incomplete";
      host: string;
      reason: string;
    };

export type CanonicalDatabaseIdentity = {
  target: DbTarget;
  database: string;
  hostIdentity: CanonicalHostIdentity;
  /**
   * A stable comparison key for the host and database. It is null when the
   * hostname contains a Neon suffix but cannot be parsed into an endpoint.
   * Ports are intentionally excluded: changing only the port does not make an
   * otherwise identical database target safe.
   */
  identity: string | null;
};

export type TestTargetEvaluation =
  | { safe: true; target: DbTarget; connectionString: string }
  | { safe: false; reason: string };

export type SafeTestTarget = Extract<TestTargetEvaluation, { safe: true }>;

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function invalidHostname(): Error {
  return new Error("Database connection string contains an invalid hostname.");
}

function normalizeHostname(hostname: string): string {
  const raw = hostname.toLowerCase().replace(/\.+$/, "");

  if (!raw) {
    throw new Error("Database connection string must include a hostname.");
  }
  if (raw.includes("%") || raw.includes("\0") || /\s/.test(raw)) {
    throw invalidHostname();
  }

  // Parse through a special-scheme URL exactly as pg-connection-string does.
  // This canonicalizes IPv4 shorthand, octal, and hexadecimal forms as well
  // as IPv6 spellings, so aliases cannot differ between the guard and the
  // database driver.
  let canonical: string;
  try {
    canonical = new URL(`http://${raw}`).hostname;
  } catch {
    throw invalidHostname();
  }

  const host = stripIpv6Brackets(canonical).replace(/\.+$/, "");
  if (!host) {
    throw invalidHostname();
  }
  if (isIP(host) !== 0) {
    return host;
  }

  if (host.length > 253) {
    throw invalidHostname();
  }

  const labels = host.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9_-]+$/.test(label),
    )
  ) {
    throw invalidHostname();
  }

  return host;
}

function normalizeDatabaseName(pathname: string): string {
  // pg-connection-string percent-decodes the pathname once, strips one
  // leading slash, then applies decodeURI. Reproduce both stages so the
  // guard and the driver resolve the same database name.
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new Error(
      "Database connection string contains malformed percent encoding in the database name.",
    );
  }

  const encoded = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : decodedPath;
  if (!encoded) {
    throw new Error(
      "Database connection string must include a database name.",
    );
  }

  let decoded: string;
  try {
    decoded = decodeURI(encoded);
  } catch {
    throw new Error(
      "Database connection string contains malformed percent encoding in the database name.",
    );
  }

  if (!decoded || decoded.includes("\0")) {
    throw new Error(
      "Database connection string must include a valid database name.",
    );
  }

  // PostgreSQL database names are case-sensitive, but comparison is
  // deliberately case-insensitive so equivalent spellings fail closed.
  return decoded.toLowerCase();
}

function assertNoHostOverride(params: URLSearchParams): void {
  for (const key of params.keys()) {
    const normalized = key.toLowerCase();
    if (normalized === "host" || normalized === "hostaddr") {
      throw new Error(
        "Database connection string must not override the host in its query string.",
      );
    }
  }
}

function parseDriverUrl(connectionString: string, protocol: string): URL {
  try {
    // pg-connection-string prefixes the URL with a special scheme. Match that
    // interpretation so parser edge cases cannot target a different host than
    // the one this guard evaluated.
    return new URL(`http:${connectionString.slice(protocol.length)}`);
  } catch {
    throw new Error("Database connection string is invalid.");
  }
}

export function parseConnectionTarget(connectionString: string): DbTarget {
  const url = new URL(connectionString);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(
      "Database connection string must use the postgresql:// or postgres:// scheme.",
    );
  }
  assertNoHostOverride(url.searchParams);

  const driverUrl = parseDriverUrl(connectionString, url.protocol);
  assertNoHostOverride(driverUrl.searchParams);

  return {
    host: normalizeHostname(driverUrl.hostname),
    database: normalizeDatabaseName(driverUrl.pathname),
  };
}

export function maskConnectionString(connectionString: string): string {
  const target = parseConnectionTarget(connectionString);
  return `${target.host}/${target.database}`;
}

function neonHostIdentity(host: string): CanonicalHostIdentity | null {
  if (host !== "neon.tech" && !host.endsWith(".neon.tech")) {
    return null;
  }

  const labels = host.split(".");
  if (labels.length < 4) {
    return {
      kind: "neon-incomplete",
      host,
      reason: "the Neon hostname is missing an endpoint ID or region",
    };
  }

  const endpointLabel = labels[0] ?? "";
  if (!/^ep-[a-z0-9][a-z0-9-]*$/.test(endpointLabel)) {
    return {
      kind: "neon-incomplete",
      host,
      reason: "the Neon hostname does not contain a recognizable endpoint ID",
    };
  }

  const region = labels.slice(1, -2).join(".");
  if (
    !region ||
    region
      .split(".")
      .some((label) => !label || !/^[a-z0-9-]+$/.test(label))
  ) {
    return {
      kind: "neon-incomplete",
      host,
      reason: "the Neon hostname does not contain a recognizable region",
    };
  }

  const pooled = endpointLabel.endsWith("-pooler");
  const endpointId = pooled
    ? endpointLabel.slice(0, -"-pooler".length)
    : endpointLabel;
  if (!/^ep-[a-z0-9][a-z0-9-]*$/.test(endpointId)) {
    return {
      kind: "neon-incomplete",
      host,
      reason: "the Neon hostname does not contain a recognizable endpoint ID",
    };
  }

  return {
    kind: "neon",
    endpointId,
    region,
    pooled,
    // Pooled and direct hosts for the same endpoint and region intentionally
    // share an identity. Different endpoints (and therefore branches) remain
    // distinct.
    identity: `neon:${endpointId}|${region}`,
  };
}

function standardHostIdentity(host: string): CanonicalHostIdentity {
  return {
    kind: "host",
    host,
    identity: `host:${host}`,
  };
}

/**
 * Resolves a configured database URL to a comparison identity.
 *
 * Neon endpoint labels use `ep-<endpoint-id>[-pooler]`. Only the trailing
 * `-pooler` on a recognized Neon endpoint label is removed; arbitrary
 * hostnames are never rewritten. Other provider and region labels are kept so
 * different branches and regions cannot accidentally compare equal.
 */
export function canonicalDatabaseIdentity(
  connectionString: string,
): CanonicalDatabaseIdentity {
  const target = parseConnectionTarget(connectionString);
  const hostIdentity =
    neonHostIdentity(target.host) ?? standardHostIdentity(target.host);

  return {
    target,
    database: target.database,
    hostIdentity,
    identity:
      hostIdentity.kind === "neon-incomplete"
        ? null
        : `${hostIdentity.identity}|db:${target.database}`,
  };
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

  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function incompleteNeonReason(
  label: string,
  identity: CanonicalDatabaseIdentity,
): string {
  const host =
    identity.hostIdentity.kind === "neon-incomplete"
      ? identity.hostIdentity.host
      : identity.target.host;
  const detail =
    identity.hostIdentity.kind === "neon-incomplete"
      ? ` (${identity.hostIdentity.reason})`
      : "";
  return `${label} uses a Neon hostname that cannot be compared safely: ${host}${detail}.`;
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

  let target: CanonicalDatabaseIdentity;
  try {
    target = canonicalDatabaseIdentity(testUrl);
  } catch (error) {
    return {
      safe: false,
      reason:
        error instanceof Error ? error.message : "Invalid TEST_DATABASE_URL.",
    };
  }

  if (target.hostIdentity.kind === "neon-incomplete") {
    return {
      safe: false,
      reason: incompleteNeonReason("TEST_DATABASE_URL", target),
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
    let devTarget: CanonicalDatabaseIdentity;
    try {
      devTarget = canonicalDatabaseIdentity(devUrl);
    } catch {
      return {
        safe: false,
        reason:
          "A configured development database URL is invalid. Refusing to run destructive tests.",
      };
    }

    if (devTarget.hostIdentity.kind === "neon-incomplete") {
      return {
        safe: false,
        reason: incompleteNeonReason(
          "A configured development database URL",
          devTarget,
        ),
      };
    }

    if (
      target.identity !== null &&
      devTarget.identity !== null &&
      target.identity === devTarget.identity
    ) {
      return {
        safe: false,
        reason: `TEST_DATABASE_URL points at the development database (${target.target.host}/${target.database}). Use a separate Neon branch or database.`,
      };
    }
  }

  return {
    safe: true,
    target: target.target,
    connectionString: testUrl,
  };
}

export function assertSafeTestTarget(
  env: Record<string, string | undefined>,
): SafeTestTarget {
  const result = evaluateTestTarget(env);
  if (!result.safe) {
    throw new Error(`Refusing destructive database operation: ${result.reason}`);
  }
  return result;
}

export function assertDestructiveTestTarget(
  env: Record<string, string | undefined>,
): string {
  return assertSafeTestTarget(env).connectionString;
}
