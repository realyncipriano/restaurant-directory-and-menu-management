type ErrorEmitter = {
  on?: (event: "error", listener: (error: unknown) => void) => unknown;
};

export function sanitizeDbError(error: unknown): string {
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? ((error as { message: string }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";

  const raw = message || "Database operation failed (details suppressed).";
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted-connection-string]")
    .replace(/(password|pwd|secret|token)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 600);
}

export function isUniqueViolation(
  error: unknown,
  depth = 0,
): boolean {
  if (!error || depth > 4) return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    detail?: unknown;
    cause?: unknown;
  };
  if (candidate.code === "23505") return true;

  const message =
    typeof candidate.message === "string"
      ? candidate.message
      : error instanceof Error
        ? error.message
        : "";
  const detail =
    typeof candidate.detail === "string" ? candidate.detail : "";

  if (
    /duplicate key value violates unique constraint/i.test(message) ||
    /23505/.test(message) ||
    /duplicate key value violates unique constraint/i.test(detail)
  ) {
    return true;
  }

  return isUniqueViolation(candidate.cause, depth + 1);
}

export function attachPoolErrorHandler(
  pool: ErrorEmitter,
  context: string,
): void {
  pool.on?.("error", (error) => {
    console.error(
      `[${context}] Database pool error: ${sanitizeDbError(error)}`,
    );
  });
}
