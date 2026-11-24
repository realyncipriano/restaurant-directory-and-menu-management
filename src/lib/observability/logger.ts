import { deploymentCommitSha } from "@/lib/build-info";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import {
  redactForLog,
  redactSensitiveText,
} from "@/lib/observability/redact";
import { isRequestId } from "@/lib/observability/request-id";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const ERROR_CATEGORIES = [
  "validation",
  "authentication",
  "authorization",
  "not_found",
  "conflict",
  "rate_limited",
  "database",
  "network",
  "timeout",
  "storage",
  "external_service",
  "configuration",
  "unknown",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export type SerializedError = {
  name: string;
  category: ErrorCategory;
  code?: string;
  status?: number;
  digest?: string;
  message?: string;
  stack?: string;
};

export type LogOptions = {
  requestId?: string | null;
  message?: string;
  context?: Record<string, unknown>;
  error?: unknown;
  /**
   * Set to false when even a sanitised error message or stack could disclose a
   * sensitive resource identifier. Name, code, status, and category remain.
   */
  includeErrorDetails?: boolean;
  includeStack?: boolean;
};

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  digest?: unknown;
  message?: unknown;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ABORT_ERR",
]);

const SQL_STATE_PATTERN =
  /^(?:08|23|28|3D|3F|40|42|53|54|55|57|58|F0|HV|P0|XX)[0-9A-Z]{3}$/;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? redactSensitiveText(value.trim()).slice(0, 200)
    : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function errorLike(error: unknown): ErrorLike {
  return (error ?? {}) as ErrorLike;
}

export function classifyError(error: unknown): ErrorCategory {
  if (error instanceof ValidationError) return "validation";
  if (
    error instanceof UnauthenticatedError ||
    error instanceof InvalidCredentialsError
  ) {
    return "authentication";
  }
  if (error instanceof ForbiddenError) return "authorization";
  if (error instanceof NotFoundError) return "not_found";
  if (error instanceof ConflictError) return "conflict";
  if (error instanceof RateLimitedError) return "rate_limited";

  const candidate = errorLike(error);
  const name = stringValue(candidate.name) ?? "";
  const code = stringValue(candidate.code) ?? "";
  const status =
    numericValue(candidate.status) ?? numericValue(candidate.statusCode);

  if (error instanceof AppError) {
    if (error.status === 401) return "authentication";
    if (error.status === 403) return "authorization";
    if (error.status === 404) return "not_found";
    if (error.status === 409) return "conflict";
    if (error.status === 429) return "rate_limited";
    return "validation";
  }

  if (code === "23505") return "conflict";
  if (
    TIMEOUT_CODES.has(code) ||
    name === "AbortError" ||
    /timeout/i.test(name)
  ) {
    return "timeout";
  }
  if (NETWORK_CODES.has(code)) return "network";
  if (SQL_STATE_PATTERN.test(code) || /postgres|neondb|pgpool/i.test(name)) {
    return "database";
  }
  if (/s3|storage|r2/i.test(name) || code === "NoSuchKey") {
    return "storage";
  }
  if (/openai|anthropic|extraction/i.test(name)) {
    return "external_service";
  }
  if (
    code.startsWith("ERR_") &&
    /(CONFIG|ENV|MISSING|INVALID)/i.test(code)
  ) {
    return "configuration";
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return "external_service";
  }

  return "unknown";
}

export function serializeError(
  error: unknown,
  {
    includeMessage = true,
    includeStack = true,
  }: { includeMessage?: boolean; includeStack?: boolean } = {},
): SerializedError | null {
  if (error === null || error === undefined) return null;

  const candidate = errorLike(error);
  const isError = error instanceof Error;
  const name =
    stringValue(candidate.name) ?? (isError ? "Error" : "NonError");
  const code = stringValue(candidate.code);
  const status =
    numericValue(candidate.status) ?? numericValue(candidate.statusCode);
  const digest = stringValue(candidate.digest);
  const rawMessage =
    isError || typeof candidate.message === "string"
      ? error instanceof Error
        ? error.message
        : String(candidate.message ?? "")
      : typeof error === "string"
        ? error
        : "";

  const serialized: SerializedError = {
    name,
    category: classifyError(error),
  };
  if (code) serialized.code = code;
  if (status !== null) serialized.status = status;
  if (digest) serialized.digest = digest;
  if (includeMessage && rawMessage) {
    serialized.message = redactSensitiveText(rawMessage).slice(0, 800);
  }
  if (includeStack && error instanceof Error && error.stack) {
    serialized.stack = redactSensitiveText(error.stack).slice(0, 4_000);
  }
  return serialized;
}

export function parseLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as LogLevel)
    : null;
}

export function activeLogLevel(
  env: NodeJS.ProcessEnv = process.env,
): LogLevel {
  return parseLogLevel(env.LOG_LEVEL) ?? "info";
}

export function isLogLevelEnabled(
  level: LogLevel,
  threshold: LogLevel = activeLogLevel(),
): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[threshold];
}

function environmentName(env: NodeJS.ProcessEnv): string {
  return (
    env.VERCEL_ENV?.trim() ||
    env.NODE_ENV?.trim() ||
    "unknown"
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "logging.serialization_failed",
      message: "A log record could not be serialized.",
    });
  }
}

export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  event: string;
  release?: string;
  requestId?: string;
  message?: string;
  error?: SerializedError;
  context?: Record<string, unknown>;
};

export function createLogRecord(
  level: LogLevel,
  event: string,
  options: LogOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): LogRecord {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    service: "restaurant-directory",
    environment: environmentName(env),
    event: redactSensitiveText(event.trim().slice(0, 120) || "log.event"),
  };

  const release = deploymentCommitSha(env);
  if (release) record.release = release;

  if (isRequestId(options.requestId)) {
    record.requestId = options.requestId;
  }
  if (options.message) {
    record.message = redactSensitiveText(options.message).slice(0, 800);
  }

  const serializedError = serializeError(options.error, {
    includeMessage: options.includeErrorDetails !== false,
    includeStack:
      options.includeErrorDetails !== false && options.includeStack !== false,
  });
  if (serializedError) record.error = serializedError;

  if (options.context && Object.keys(options.context).length > 0) {
    const redacted = redactForLog(options.context);
    if (
      redacted &&
      typeof redacted === "object" &&
      !Array.isArray(redacted)
    ) {
      record.context = redacted as Record<string, unknown>;
    }
  }

  return record;
}

function writeRecord(level: LogLevel, record: LogRecord): void {
  const line = safeStringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function writeFallback(): void {
  try {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "restaurant-directory",
        event: "logging.failed",
        message: "A log record could not be written.",
      }),
    );
  } catch {
    // Logging must never propagate a failure into application control flow.
  }
}

export function log(
  level: LogLevel,
  event: string,
  options: LogOptions = {},
): void {
  try {
    if (!isLogLevelEnabled(level)) return;
    writeRecord(level, createLogRecord(level, event, options));
  } catch {
    writeFallback();
  }
}

export const logger = {
  debug(event: string, options?: LogOptions): void {
    log("debug", event, options);
  },
  info(event: string, options?: LogOptions): void {
    log("info", event, options);
  },
  warn(event: string, options?: LogOptions): void {
    log("warn", event, options);
  },
  error(event: string, options?: LogOptions): void {
    log("error", event, options);
  },
};
