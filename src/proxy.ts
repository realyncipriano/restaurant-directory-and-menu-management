import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { logger } from "@/lib/observability/logger";
import { runWithRequestContext } from "@/lib/observability/request-context";
import {
  REQUEST_ID_HEADER,
  requestIdFromHeaders,
} from "@/lib/observability/request-id";
import {
  publicMenuExists,
  publicRestaurantExists,
} from "@/server/services/public-existence";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESTAURANT_PATH_PATTERN = /^\/restaurants\/([^/]+)\/?$/;
const MENU_PATH_PATTERN =
  /^\/restaurants\/([^/]+)\/menus\/([^/]+)\/?$/;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Page not found</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: #fafafa;
        color: #18181b;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { max-width: 32rem; text-align: center; }
      .code {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #b45309;
      }
      h1 { margin: 0.5rem 0 0; font-size: 1.75rem; }
      p { margin: 0.75rem 0 0; line-height: 1.6; color: #52525b; }
      a {
        display: inline-block;
        margin-top: 1.5rem;
        padding: 0.65rem 1rem;
        border-radius: 0.5rem;
        background: #18181b;
        color: #ffffff;
        font-weight: 600;
        text-decoration: none;
      }
      a:hover { background: #27272a; }
    </style>
  </head>
  <body>
    <main>
      <p class="code">404</p>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist or is no longer available.</p>
      <a href="/">Back to the directory</a>
    </main>
  </body>
</html>`;

const SERVICE_UNAVAILABLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Directory temporarily unavailable</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: #fafafa;
        color: #18181b;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { max-width: 32rem; text-align: center; }
      .code {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #b45309;
      }
      h1 { margin: 0.5rem 0 0; font-size: 1.75rem; }
      p { margin: 0.75rem 0 0; line-height: 1.6; color: #52525b; }
    </style>
  </head>
  <body>
    <main>
      <p class="code">503</p>
      <h1>Directory temporarily unavailable</h1>
      <p>We could not load this page right now. Please try again in a moment.</p>
    </main>
  </body>
</html>`;

// A short, explicit retry window: long enough to avoid hammering a recovering
// database, short enough that a user retry is still useful.
const RETRY_AFTER_SECONDS = 30;

function isDashboardPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/dashboard.")
  );
}

function withRequestId<T extends Response>(
  response: T,
  requestId: string,
): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function nextWithRequestId(
  request: NextRequest,
  requestId: string,
): NextResponse {
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  return withRequestId(response, requestId);
}

function redirectToLogin(
  request: NextRequest,
  requestId: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return withRequestId(NextResponse.redirect(url), requestId);
}

function notFoundResponse(method: string, requestId: string): Response {
  return withRequestId(
    new Response(method === "HEAD" ? null : NOT_FOUND_HTML, {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    }),
    requestId,
  );
}

function serviceUnavailableResponse(
  method: string,
  requestId: string,
): Response {
  return withRequestId(
    new Response(method === "HEAD" ? null : SERVICE_UNAVAILABLE_HTML, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(RETRY_AFTER_SECONDS),
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    }),
    requestId,
  );
}

function logExistenceFailure(
  kind: "restaurant" | "menu",
  error: unknown,
  requestId: string,
): void {
  // Deliberately omit the URL, slug, message, stack, and query text. Name,
  // code, and category are enough to distinguish a database outage from a
  // programming error without leaking connection details.
  logger.error("proxy.public_existence_check_failed", {
    requestId,
    error,
    includeErrorDetails: false,
    context: { kind, responseStatus: 503 },
  });
}

function isNonDocumentRequest(request: NextRequest): boolean {
  const destination = request.headers.get("sec-fetch-dest");
  return destination !== null && destination !== "document";
}

async function handleProxy(
  request: NextRequest,
  requestId: string,
): Promise<Response> {
  const { pathname } = request.nextUrl;

  if (isDashboardPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return redirectToLogin(request, requestId);
    }

    return nextWithRequestId(request, requestId);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return nextWithRequestId(request, requestId);
  }

  if (isNonDocumentRequest(request)) {
    return nextWithRequestId(request, requestId);
  }

  const menuMatch = MENU_PATH_PATTERN.exec(pathname);
  const restaurantMatch = menuMatch
    ? null
    : RESTAURANT_PATH_PATTERN.exec(pathname);

  if (!menuMatch && !restaurantMatch) {
    return nextWithRequestId(request, requestId);
  }

  if (menuMatch) {
    const restaurantSlug = menuMatch[1];
    const menuSlug = menuMatch[2];

    if (
      !restaurantSlug ||
      !menuSlug ||
      !SLUG_PATTERN.test(restaurantSlug) ||
      !SLUG_PATTERN.test(menuSlug)
    ) {
      return notFoundResponse(request.method, requestId);
    }

    let exists: boolean;
    try {
      exists = await publicMenuExists(
        getDb(),
        restaurantSlug,
        menuSlug,
      );
    } catch (error) {
      // A database failure must not produce a false 404. Return a retryable
      // 503 rather than falling through to rendering, which would produce a
      // 200 error shell. This catch is intentionally scoped to the existence
      // check; connection failures can surface as generic errors, so treating
      // any exception here as unavailable is safer than guessing.
      logExistenceFailure("menu", error, requestId);
      return serviceUnavailableResponse(request.method, requestId);
    }

    if (!exists) {
      return notFoundResponse(request.method, requestId);
    }

    return nextWithRequestId(request, requestId);
  }

  const restaurantSlug = restaurantMatch?.[1];
  if (!restaurantSlug || !SLUG_PATTERN.test(restaurantSlug)) {
    return notFoundResponse(request.method, requestId);
  }

  let exists: boolean;
  try {
    exists = await publicRestaurantExists(getDb(), restaurantSlug);
  } catch (error) {
    // See the menu existence-check note above.
    logExistenceFailure("restaurant", error, requestId);
    return serviceUnavailableResponse(request.method, requestId);
  }

  if (!exists) {
    return notFoundResponse(request.method, requestId);
  }

  return nextWithRequestId(request, requestId);
}

export async function proxy(request: NextRequest): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);

  return runWithRequestContext(
    {
      requestId,
      method: request.method,
      route: request.nextUrl.pathname,
    },
    () => handleProxy(request, requestId),
  );
}

export const config = {
  matcher: [
    "/",
    "/restaurants",
    "/login",
    "/activate",
    "/dashboard/:path*",
    "/api/health",
    "/api/health/ready",
    {
      source: "/restaurants/:slug",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "prefetch.*" },
      ],
    },
    {
      source: "/restaurants/:slug/menus/:menuSlug",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "prefetch.*" },
      ],
    },
  ],
};
