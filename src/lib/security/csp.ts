/**
 * Report-only CSP baseline.
 *
 * Scripts and styles still allow inline execution because Next.js emits inline
 * bootstrap data and the app uses inline style attributes. The policy is
 * deliberately report-only until those sources are audited; the reporting
 * endpoint receives sanitized violation metadata so the policy can be tightened
 * without collecting URLs, query strings, or page content.
 */

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

export const CSP_REPORT_CONTENT_TYPES = [
  "application/csp-report",
  "application/reports+json",
] as const;

export function buildCspReportOnlyPolicy(
  reportPath: string = CSP_REPORT_PATH,
): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    `report-uri ${reportPath}`,
  ].join("; ");
}

export type CspViolationReport = {
  directive: string;
  disposition: string;
  blockedUri: string;
  documentPath: string;
  sourceFile: string | null;
  lineNumber: number | null;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/gu, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}...`
    : trimmed;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function sanitizedUri(value: unknown): string | null {
  const text = textValue(value, 2048);
  if (!text) return null;
  if (/^(?:inline|eval|wasm-eval|data|blob)$/iu.test(text)) return text;

  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`.slice(0, 512);
  } catch {
    const relative = text.split(/[?#]/u)[0];
    return relative?.startsWith("/") ? relative.slice(0, 512) : null;
  }
}

function documentPath(value: unknown, origin: string): string | null {
  const text = textValue(value, 2048);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== origin) return null;
    return (url.pathname || "/").slice(0, 512);
  } catch {
    return null;
  }
}

/**
 * Accepts both the legacy `application/csp-report` envelope and the Reporting
 * API `application/reports+json` array. URLs are reduced to origin and path so
 * activation tokens, reset links, and query parameters never reach logs.
 */
export function parseCspReport(
  payload: unknown,
  origin: string,
): CspViolationReport | null {
  const legacy = objectValue(objectValue(payload)?.["csp-report"]);
  const entries = Array.isArray(payload) ? payload : [];
  const reportingEntry = entries
    .map(objectValue)
    .find((entry) => entry?.type === "csp-violation");
  const body =
    legacy ?? objectValue(reportingEntry?.body) ?? objectValue(payload);

  if (!body) return null;

  const path = documentPath(body.documentURL ?? body["document-uri"], origin);
  if (!path) return null;

  return {
    directive:
      textValue(
        body.effectiveDirective ??
          body["effective-directive"] ??
          body["violated-directive"],
      ) ?? "unknown",
    disposition: textValue(body.disposition) ?? "report",
    blockedUri:
      sanitizedUri(body.blockedURL ?? body["blocked-uri"]) ?? "unknown",
    documentPath: path,
    sourceFile: sanitizedUri(body.sourceFile ?? body["source-file"]),
    lineNumber: numberValue(body.lineNumber ?? body["line-number"]),
  };
}
