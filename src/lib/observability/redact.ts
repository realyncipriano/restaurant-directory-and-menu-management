const MAX_TEXT_LENGTH = 2_000;
const MAX_LOG_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;

const CONNECTION_STRING_PATTERN =
  /\b(?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql):\/\/[^\s"'<>]+/gi;
const SENTRY_DSN_PATTERN =
  /https:\/\/[A-Za-z0-9]+@[^\s"'<>]*sentry\.io[^\s"'<>]*/gi;
const URL_WITH_CREDENTIALS_PATTERN =
  /\bhttps?:\/\/[^\s"'<>@]+@[^\s"'<>]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const COOKIE_VALUE_PATTERN =
  /(^|[;\s])([A-Za-z0-9_.-]*(?:session|token|auth)[A-Za-z0-9_.-]*)=([^;\s]+)/gi;
const KEY_VALUE_SECRET_PATTERN =
  /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|authorization|cookie|connection[_-]?string|database[_-]?url|dsn)\s*[:=]\s*)([^\s&,;"'}]+)/gi;
const URL_SECRET_QUERY_PATTERN =
  /([?&](?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|signature|sig|code)=)[^&\s#]+/gi;
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "cookie",
  "authorization",
  "apikey",
  "accesskey",
  "secretkey",
  "privatekey",
  "credential",
  "connectionstring",
  "databaseurl",
  "dsn",
  "session",
];

function truncate(value: string, limit = MAX_TEXT_LENGTH): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}[truncated]`;
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

/**
 * Removes credentials and other secrets from free-form text before it is
 * written to logs. This is a defence-in-depth measure, not a substitute for
 * never collecting the raw value in the first place.
 */
export function redactSensitiveText(value: string): string {
  const redacted = value
    .replace(CONNECTION_STRING_PATTERN, "[redacted-connection-string]")
    .replace(SENTRY_DSN_PATTERN, "[redacted-dsn]")
    .replace(URL_WITH_CREDENTIALS_PATTERN, "[redacted-url-with-credentials]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(COOKIE_VALUE_PATTERN, "$1$2=[redacted]")
    .replace(KEY_VALUE_SECRET_PATTERN, "$1[redacted]")
    .replace(URL_SECRET_QUERY_PATTERN, "$1[redacted]")
    .replace(EMAIL_PATTERN, "[redacted-email]");

  return truncate(redacted);
}

function redactError(error: Error): Record<string, unknown> {
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name || "Error",
    message: redactSensitiveText(error.message),
    ...(typeof code === "string" && code
      ? { code: redactSensitiveText(code) }
      : {}),
    ...(error.stack
      ? { stack: truncate(redactSensitiveText(error.stack), 4_000) }
      : {}),
  };
}

/**
 * Converts arbitrary log context into a JSON-safe, redacted value. It never
 * serialises request headers, cookies, form data, or other raw request input
 * because callers must select the fields they pass in.
 */
export function redactForLog(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "[non-finite-number]";
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";

  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactSensitiveText(value.toString());
  if (value instanceof Error) return redactError(value);
  if (ArrayBuffer.isView(value)) return "[binary]";

  if (depth >= MAX_LOG_DEPTH) return "[max-depth]";

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactForLog(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, entry] of entries) {
    if (entry === undefined) continue;
    output[key] = isSensitiveLogKey(key)
      ? "[redacted]"
      : redactForLog(entry, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    output._truncatedKeys =
      Object.keys(value).length - MAX_OBJECT_KEYS;
  }
  return output;
}

export { MAX_TEXT_LENGTH };
