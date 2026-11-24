import { logger } from "@/lib/observability/logger";
import {
  CSP_REPORT_CONTENT_TYPES,
  CSP_REPORT_MAX_BYTES,
  parseCspReport,
} from "@/lib/security/csp";

function contentType(request: Request): string | null {
  return (
    request.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ?? null
  );
}

/**
 * Receives report-only CSP violations and writes sanitized metadata to the
 * structured log. Reports carry no application state, so this endpoint never
 * touches the database.
 */
export async function POST(request: Request): Promise<Response> {
  const mediaType = contentType(request);
  if (
    !mediaType ||
    !CSP_REPORT_CONTENT_TYPES.includes(
      mediaType as (typeof CSP_REPORT_CONTENT_TYPES)[number],
    )
  ) {
    return new Response(null, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > CSP_REPORT_MAX_BYTES
  ) {
    return new Response(null, { status: 413 });
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > CSP_REPORT_MAX_BYTES) {
    return new Response(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }

  const report = parseCspReport(payload, new URL(request.url).origin);
  if (report) {
    logger.warn("csp.violation", { context: { ...report } });
  }

  return new Response(null, { status: 204 });
}
