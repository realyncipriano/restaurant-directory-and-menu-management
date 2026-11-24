import "server-only";

import { headers } from "next/headers";

import {
  REQUEST_ID_HEADER,
  isRequestId,
} from "@/lib/observability/request-id";
import {
  getRequestContext,
  runWithRequestContext,
} from "@/lib/observability/request-context";

/**
 * Reads the request ID forwarded by the proxy. This is a correlation value
 * only; it must never be treated as an authenticated identity.
 */
export async function requestIdFromServerHeaders(): Promise<string | null> {
  try {
    const store = await headers();
    const value = store.get(REQUEST_ID_HEADER);
    return isRequestId(value) ? value : null;
  } catch {
    // headers() is unavailable outside a request scope (for example in a CLI
    // script or a background task). Logging still works without a request ID.
    return null;
  }
}

export async function getRequestIdForLogging(): Promise<string | null> {
  return getRequestContext()?.requestId ?? requestIdFromServerHeaders();
}

/**
 * Establishes an AsyncLocalStorage request context for server actions and
 * route handlers. If a context already exists the callback runs unchanged.
 */
export async function withRequestContext<T>(
  callback: (requestId: string | null) => Promise<T>,
): Promise<T> {
  const existing = getRequestContext();
  if (existing) return callback(existing.requestId);

  const requestId = await requestIdFromServerHeaders();
  return runWithRequestContext({ requestId }, () => callback(requestId));
}
