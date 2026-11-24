import type { Instrumentation } from "next";

import { logger } from "@/lib/observability/logger";
import { isRequestId } from "@/lib/observability/request-id";

function forwardedRequestId(
  headers: NodeJS.Dict<string | string[]>,
): string | null {
  const value = headers["x-request-id"];
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRequestId(candidate) ? candidate : null;
}

/**
 * Last-resort server error reporting. The request path and headers are
 * intentionally not logged: paths can contain reset tokens and headers contain
 * cookies and authorization values.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  logger.error("request.unhandled_error", {
    requestId: forwardedRequestId(request.headers),
    error,
    context: {
      method: request.method,
      routerKind: context.routerKind,
      routeType: context.routeType,
      routePath: context.routePath,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
    },
  });
};
