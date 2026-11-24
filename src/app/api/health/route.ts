import { NextResponse } from "next/server";

import { deploymentCommitSha } from "@/lib/build-info";
import {
  REQUEST_ID_HEADER,
  requestIdFromHeaders,
} from "@/lib/observability/request-id";

function healthResponse(
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

function livenessBody(): { status: string; commit?: string } {
  const commit = deploymentCommitSha();
  return commit ? { status: "ok", commit } : { status: "ok" };
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdFromHeaders(request.headers);
  return healthResponse(livenessBody(), 200, requestId);
}
