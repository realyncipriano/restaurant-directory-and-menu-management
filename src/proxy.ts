import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { SESSION_COOKIE } from "@/lib/auth/constants";
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

function isDashboardPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/dashboard.")
  );
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

function notFoundResponse(method: string): Response {
  return new Response(method === "HEAD" ? null : NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function logExistenceFailure(
  kind: "restaurant" | "menu",
  error: unknown,
): void {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  const name =
    typeof candidate?.name === "string" ? candidate.name : "Error";
  const code =
    typeof candidate?.code === "string" ? candidate.code : "unknown";

  // Deliberately omit the URL, slug, message, stack, and query text.
  console.error(
    `[proxy] Public ${kind} existence check failed (name=${name}, code=${code}); failing open.`,
  );
}

function isNonDocumentRequest(request: NextRequest): boolean {
  const destination = request.headers.get("sec-fetch-dest");
  return destination !== null && destination !== "document";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isDashboardPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return redirectToLogin(request);
    }

    return NextResponse.next();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next();
  }

  if (isNonDocumentRequest(request)) {
    return NextResponse.next();
  }

  const menuMatch = MENU_PATH_PATTERN.exec(pathname);
  const restaurantMatch = menuMatch
    ? null
    : RESTAURANT_PATH_PATTERN.exec(pathname);

  if (!menuMatch && !restaurantMatch) {
    return NextResponse.next();
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
      return notFoundResponse(request.method);
    }

    try {
      const exists = await publicMenuExists(
        getDb(),
        restaurantSlug,
        menuSlug,
      );
      if (!exists) {
        return notFoundResponse(request.method);
      }
    } catch (error) {
      // A transient database failure must not produce a false 404. Fail open
      // and let the existing page/data layer handle the request.
      logExistenceFailure("menu", error);
    }

    return NextResponse.next();
  }

  const restaurantSlug = restaurantMatch?.[1];
  if (!restaurantSlug || !SLUG_PATTERN.test(restaurantSlug)) {
    return notFoundResponse(request.method);
  }

  try {
    const exists = await publicRestaurantExists(getDb(), restaurantSlug);
    if (!exists) {
      return notFoundResponse(request.method);
    }
  } catch (error) {
    // See the fail-open note above.
    logExistenceFailure("restaurant", error);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
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
