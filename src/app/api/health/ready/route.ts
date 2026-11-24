import { NextResponse } from "next/server";

import { deploymentCommitSha } from "@/lib/build-info";
import { logger } from "@/lib/observability/logger";
import {
  REQUEST_ID_HEADER,
  requestIdFromHeaders,
} from "@/lib/observability/request-id";
import { probeDatabaseReadiness } from "@/server/services/health";

function readinessResponse(
  body: { status: string; commit?: string },
  status: number,
  requestId: string,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

function commitField(): { commit?: string } {
  const commit = deploymentCommitSha();
  return commit ? { commit } : {};
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);

  try {
    await probeDatabaseReadiness();
    return readinessResponse(
      { status: "ready", ...commitField() },
      200,
      requestId,
    );
  } catch (error) {
    // The response deliberately says nothing about the failing dependency.
    // Diagnostic detail stays in server logs, where it is redacted.
    logger.error("health.readiness_failed", {
      requestId,
      error,
      context: { check: "database" },
    });
    return readinessResponse({ status: "unavailable" }, 503, requestId);
  }
}
