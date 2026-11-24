import { randomUUID } from "node:crypto";

import { isRequestId } from "../../src/lib/observability/request-id";

export type SmokeResult = "PASS" | "FAIL" | "BLOCKED";

export type SmokeCheck = {
  id: string;
  result: SmokeResult;
  expected: string;
  observed: Record<string, unknown>;
  failure?: string;
};

export type PublicSmokeReport = {
  base: string;
  generatedAt: string;
  expectedCommit: string | null;
  commit: string | null;
  summary: {
    pass: number;
    fail: number;
    blocked: number;
    total: number;
  };
  checks: SmokeCheck[];
};

export type PublicSmokeOptions = {
  baseUrl: string;
  expectedCommit?: string | null;
  restaurantSlug?: string | null;
  menuSlug?: string | null;
  timeoutMs?: number;
};

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type ObservedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const SAFE_HEADERS = [
  "content-type",
  "cache-control",
  "x-robots-tag",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "x-request-id",
  "retry-after",
  "location",
];

function normalizedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMOKE_BASE_URL must be an absolute http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SMOKE_BASE_URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error(
      "SMOKE_BASE_URL must not contain embedded credentials.",
    );
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function safeHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of SAFE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

function hasHealthHeaders(response: ObservedResponse): boolean {
  return (
    response.headers["cache-control"] === "no-store" &&
    response.headers["x-content-type-options"] === "nosniff" &&
    response.headers["x-robots-tag"] === "noindex" &&
    response.headers["referrer-policy"] === "no-referrer"
  );
}

async function get(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<ObservedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "user-agent": "rdmm-public-smoke/1.0",
        ...headers,
      },
      signal: controller.signal,
    });
    return {
      status: response.status,
      headers: safeHeaders(response),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function observed(
  response: ObservedResponse,
): Record<string, unknown> {
  return {
    status: response.status,
    contentType: response.headers["content-type"] ?? null,
    cacheControl: response.headers["cache-control"] ?? null,
    robots: response.headers["x-robots-tag"] ?? null,
    nosniff: response.headers["x-content-type-options"] ?? null,
    referrerPolicy: response.headers["referrer-policy"] ?? null,
    requestId: response.headers["x-request-id"] ?? null,
    location: response.headers["location"] ?? null,
    bodyLength: response.body.length,
  };
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}

function containsUnsafeDetail(body: string, slug: string): boolean {
  return (
    body.includes(slug) ||
    /postgres(?:ql)?:\/\//i.test(body) ||
    body.includes("DATABASE_URL") ||
    /password\s*=/i.test(body)
  );
}

function errorDescription(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 300);
  }
  return "Request failed.";
}

async function check(
  id: string,
  expected: string,
  run: () => Promise<Omit<SmokeCheck, "id" | "expected">>,
): Promise<SmokeCheck> {
  try {
    return { id, expected, ...(await run()) };
  } catch (error) {
    return {
      id,
      result: "FAIL",
      expected,
      observed: {},
      failure: errorDescription(error),
    };
  }
}

function pass(
  observed: Record<string, unknown>,
): Omit<SmokeCheck, "id" | "expected"> {
  return { result: "PASS", observed };
}

function fail(
  observed: Record<string, unknown>,
  failure: string,
): Omit<SmokeCheck, "id" | "expected"> {
  return { result: "FAIL", observed, failure };
}

function blocked(
  observed: Record<string, unknown>,
  failure: string,
): Omit<SmokeCheck, "id" | "expected"> {
  return { result: "BLOCKED", observed, failure };
}

function expectedCommitMatches(
  commit: string | null,
  expected: string | null,
): boolean {
  if (!expected) return true;
  return commit?.toLowerCase() === expected.toLowerCase();
}

export async function runPublicSmoke(
  options: PublicSmokeOptions,
  fetchImpl: FetchLike = fetch,
): Promise<PublicSmokeReport> {
  const base = normalizedBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const restaurantSlug = options.restaurantSlug?.trim() || null;
  const menuSlug = options.menuSlug?.trim() || null;
  const expectedCommit = options.expectedCommit?.trim() || null;
  const missingSlug = `smoke-missing-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const checks: SmokeCheck[] = [];

  checks.push(
    await check("homepage", "HTTP 200 HTML document", async () => {
      const response = await get(fetchImpl, `${base}/`, timeoutMs);
      const body = response.body;
      const contentType = response.headers["content-type"] ?? "";
      const ok =
        response.status === 200 &&
        contentType.startsWith("text/html") &&
        response.headers["x-content-type-options"] === "nosniff" &&
        Boolean(response.headers["referrer-policy"]);
      return ok
        ? pass({ ...observed(response), title: titleOf(body) })
        : fail(
            { ...observed(response), title: titleOf(body) },
            "Expected a 200 HTML document with baseline security headers.",
          );
    }),
  );

  checks.push(
    await check(
      "restaurant-document",
      "HTTP 200 HTML document for a known restaurant slug",
      async () => {
        if (!restaurantSlug) {
          return blocked(
            {},
            "SMOKE_RESTAURANT_SLUG (or --restaurant) is not set.",
          );
        }
        const response = await get(
          fetchImpl,
          `${base}/restaurants/${encodeURIComponent(restaurantSlug)}`,
          timeoutMs,
        );
        const contentType = response.headers["content-type"] ?? "";
        return response.status === 200 &&
          contentType.startsWith("text/html")
          ? pass({ ...observed(response), title: titleOf(response.body) })
          : fail(
              {
                ...observed(response),
                title: titleOf(response.body),
              },
              "Expected the restaurant document to render with HTTP 200.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "menu-document",
      "HTTP 200 HTML document for a known menu slug",
      async () => {
        if (!restaurantSlug || !menuSlug) {
          return blocked(
            {},
            "Set SMOKE_RESTAURANT_SLUG and SMOKE_MENU_SLUG to check a menu document.",
          );
        }
        const response = await get(
          fetchImpl,
          `${base}/restaurants/${encodeURIComponent(restaurantSlug)}/menus/${encodeURIComponent(menuSlug)}`,
          timeoutMs,
        );
        const contentType = response.headers["content-type"] ?? "";
        return response.status === 200 &&
          contentType.startsWith("text/html")
          ? pass({ ...observed(response), title: titleOf(response.body) })
          : fail(
              {
                ...observed(response),
                title: titleOf(response.body),
              },
              "Expected the menu document to render with HTTP 200.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "missing-restaurant-404",
      "HTTP 404 with no-store, noindex, and nosniff headers",
      async () => {
        const response = await get(
          fetchImpl,
          `${base}/restaurants/${missingSlug}`,
          timeoutMs,
        );
        const headersOk =
          response.headers["cache-control"] === "no-store" &&
          response.headers["x-robots-tag"] === "noindex" &&
          response.headers["x-content-type-options"] === "nosniff";
        const contentType = response.headers["content-type"] ?? "";
        const safe = !containsUnsafeDetail(response.body, missingSlug);
        return response.status === 404 &&
          contentType.startsWith("text/html") &&
          headersOk &&
          safe
          ? pass(observed(response))
          : fail(
              observed(response),
              "Expected a genuine 404 with baseline error headers and no reflected slug.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "invalid-slug-404",
      "HTTP 404 for invalid restaurant and menu slugs",
      async () => {
        const restaurant = await get(
          fetchImpl,
          `${base}/restaurants/Invalid_Slug`,
          timeoutMs,
        );
        const menu = await get(
          fetchImpl,
          `${base}/restaurants/Invalid_Slug/menus/Also_Invalid`,
          timeoutMs,
        );
        const bothSafe =
          !containsUnsafeDetail(restaurant.body, "Invalid_Slug") &&
          !containsUnsafeDetail(menu.body, "Also_Invalid");
        return restaurant.status === 404 &&
          menu.status === 404 &&
          bothSafe
          ? pass({
              restaurant: observed(restaurant),
              menu: observed(menu),
            })
          : fail(
              {
                restaurant: observed(restaurant),
                menu: observed(menu),
              },
              "Invalid slugs must be rejected before any database lookup.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "login-page",
      "HTTP 200 sign-in page with no-store and nosniff",
      async () => {
        const response = await get(fetchImpl, `${base}/login`, timeoutMs);
        const contentType = response.headers["content-type"] ?? "";
        const ok =
          response.status === 200 &&
          contentType.startsWith("text/html") &&
          response.headers["cache-control"] === "no-store" &&
          response.headers["x-content-type-options"] === "nosniff";
        return ok
          ? pass({ ...observed(response), title: titleOf(response.body) })
          : fail(
              { ...observed(response), title: titleOf(response.body) },
              "Expected the sign-in page to render with no-store and nosniff.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "dashboard-redirect",
      "Unauthenticated dashboard requests redirect to /login with a safe next path",
      async () => {
        const response = await get(fetchImpl, `${base}/dashboard`, timeoutMs);
        const location = response.headers["location"] ?? "";
        let target: URL | null = null;
        try {
          target = new URL(location, `${base}/`);
        } catch {
          target = null;
        }
        const ok =
          response.status === 307 &&
          target?.pathname === "/login" &&
          target.searchParams.get("next") === "/dashboard" &&
          isRequestId(response.headers["x-request-id"] ?? null);
        return ok
          ? pass(observed(response))
          : fail(
              observed(response),
              "Expected a 307 redirect to /login with next=/dashboard and a request ID.",
            );
      },
    ),
  );

  let livenessCommit: string | null = null;
  checks.push(
    await check(
      "health-liveness",
      "HTTP 200 { status: 'ok' } without a database dependency",
      async () => {
        const response = await get(
          fetchImpl,
          `${base}/api/health`,
          timeoutMs,
        );
        let body: unknown = null;
        try {
          body = JSON.parse(response.body);
        } catch {
          body = null;
        }
        const record =
          body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : null;
        livenessCommit =
          typeof record?.commit === "string" ? record.commit : null;
        const requestId = response.headers["x-request-id"] ?? null;
        const ok =
          response.status === 200 &&
          record?.status === "ok" &&
          hasHealthHeaders(response) &&
          isRequestId(requestId);
        return ok
          ? pass({
              ...observed(response),
              status: record?.status ?? null,
              commit: livenessCommit,
            })
          : fail(
              {
                ...observed(response),
                status: record?.status ?? null,
                commit: livenessCommit,
              },
              "Expected a 200 liveness response with no-store, nosniff, noindex, no-referrer, and a request ID.",
            );
      },
    ),
  );

  let readinessCommit: string | null = null;
  checks.push(
    await check(
      "health-readiness",
      "HTTP 200 { status: 'ready' } with a minimal database probe",
      async () => {
        const response = await get(
          fetchImpl,
          `${base}/api/health/ready`,
          timeoutMs,
        );
        let body: unknown = null;
        try {
          body = JSON.parse(response.body);
        } catch {
          body = null;
        }
        const record =
          body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : null;
        readinessCommit =
          typeof record?.commit === "string" ? record.commit : null;
        const requestId = response.headers["x-request-id"] ?? null;
        const ok =
          response.status === 200 &&
          record?.status === "ready" &&
          hasHealthHeaders(response) &&
          isRequestId(requestId);
        return ok
          ? pass({
              ...observed(response),
              status: record?.status ?? null,
              commit: readinessCommit,
            })
          : fail(
              {
                ...observed(response),
                status: record?.status ?? null,
                commit: readinessCommit,
              },
              "Readiness must return 200 only when the database probe succeeds, with no-store, nosniff, noindex, no-referrer, and a request ID.",
            );
      },
    ),
  );

  checks.push(
    await check(
      "request-id-propagation",
      "A valid inbound x-request-id is echoed on the response",
      async () => {
        const sentinel = `smoke-${randomUUID()}`;
        const response = await get(
          fetchImpl,
          `${base}/api/health`,
          timeoutMs,
          { "x-request-id": sentinel },
        );
        const returned = response.headers["x-request-id"] ?? null;
        return returned === sentinel
          ? pass({ ...observed(response), sentinel })
          : fail(
              { ...observed(response), sentinel },
              "The response did not preserve the valid correlation ID.",
            );
      },
    ),
  );

  const observedCommit = livenessCommit ?? readinessCommit;
  checks.push(
    await check(
      "deployment-commit",
      "Health endpoints identify the exact deployed commit",
      async () => {
        if (!expectedCommit) {
          return blocked(
            {
              observedCommit,
              livenessCommit,
              readinessCommit,
            },
            "SMOKE_EXPECTED_SHA (or --expected-sha) is not set.",
          );
        }
        const matches =
          expectedCommitMatches(livenessCommit, expectedCommit) &&
          expectedCommitMatches(readinessCommit, expectedCommit);
        return matches
          ? pass({ expectedCommit, livenessCommit, readinessCommit })
          : fail(
              { expectedCommit, livenessCommit, readinessCommit },
              "The deployed commit does not match the expected commit.",
            );
      },
    ),
  );

  const summary = {
    pass: checks.filter((entry) => entry.result === "PASS").length,
    fail: checks.filter((entry) => entry.result === "FAIL").length,
    blocked: checks.filter((entry) => entry.result === "BLOCKED").length,
    total: checks.length,
  };

  return {
    base,
    generatedAt: new Date().toISOString(),
    expectedCommit,
    commit: observedCommit,
    summary,
    checks,
  };
}

export function exitCodeForReport(
  report: PublicSmokeReport,
  requireDocuments = false,
): number {
  if (report.summary.fail > 0) return 1;
  if (requireDocuments && report.summary.blocked > 0) return 2;
  return 0;
}
