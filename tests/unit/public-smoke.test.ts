import { describe, expect, it } from "vitest";

import {
  exitCodeForReport,
  runPublicSmoke,
} from "../../scripts/lib/public-smoke";

const COMMIT = "e857ba2586e1b9085386863c1276a4b6f87e9c5f";
const BASE = "https://example.test";

function response(
  body: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

function htmlHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

function notFoundHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "x-content-type-options": "nosniff",
  };
}

function json(
  body: Record<string, unknown>,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return response(JSON.stringify(body), 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId,
    ...extraHeaders,
  });
}

const healthyFetch = async (
  input: string,
  init?: RequestInit,
): Promise<Response> => {
  const path = new URL(input).pathname;
  const requestId =
    new Headers(init?.headers).get("x-request-id") ??
    "req_fake-health-1234";

  if (path === "/") {
    return response(
      "<!doctype html><html><head><title>Directory</title></head><body>ok</body></html>",
      200,
      { ...htmlHeaders(), "set-cookie": "rdmm_session=secret-value" },
    );
  }
  if (path === "/login") {
    return response(
      "<!doctype html><html><head><title>Sign in</title></head></html>",
      200,
      { ...htmlHeaders(), "cache-control": "no-store" },
    );
  }
  if (path === "/dashboard") {
    return response("", 307, {
      location: "/login?next=%2Fdashboard",
      "x-request-id": requestId,
    });
  }
  if (path === "/api/health") {
    return json({ status: "ok", commit: COMMIT }, requestId);
  }
  if (path === "/api/health/ready") {
    return json({ status: "ready", commit: COMMIT }, requestId);
  }
  if (path === "/restaurants/k-cafe") {
    return response(
      "<!doctype html><html><head><title>K-Cafe</title></head></html>",
      200,
      htmlHeaders(),
    );
  }
  if (path === "/restaurants/k-cafe/menus/lunch") {
    return response(
      "<!doctype html><html><head><title>Lunch</title></head></html>",
      200,
      htmlHeaders(),
    );
  }
  if (
    path.startsWith("/restaurants/smoke-missing-") ||
    path.startsWith("/restaurants/Invalid_Slug")
  ) {
    return response(
      "<!doctype html><html><head><title>Page not found</title></head></html>",
      404,
      notFoundHeaders(),
    );
  }

  return response("Not found", 404, { "content-type": "text/plain" });
};

describe("public smoke checks", () => {
  it("passes a complete read-only baseline", async () => {
    const report = await runPublicSmoke(
      {
        baseUrl: BASE,
        expectedCommit: COMMIT,
        restaurantSlug: "k-cafe",
        menuSlug: "lunch",
      },
      healthyFetch,
    );

    expect(report.summary).toEqual({
      pass: 11,
      fail: 0,
      blocked: 0,
      total: 11,
    });
    expect(report.commit).toBe(COMMIT);
    expect(exitCodeForReport(report, true)).toBe(0);
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(
      report.checks.find((check) => check.id === "request-id-propagation")
        ?.result,
    ).toBe("PASS");
  });

  it("marks document checks as blocked when slugs are not configured", async () => {
    const report = await runPublicSmoke(
      { baseUrl: BASE, expectedCommit: COMMIT },
      healthyFetch,
    );

    expect(
      report.checks.find((check) => check.id === "restaurant-document")
        ?.result,
    ).toBe("BLOCKED");
    expect(
      report.checks.find((check) => check.id === "menu-document")?.result,
    ).toBe("BLOCKED");
    expect(exitCodeForReport(report, false)).toBe(0);
    expect(exitCodeForReport(report, true)).toBe(2);
  });

  it("fails when a public document or health check is wrong", async () => {
    const brokenFetch = async (
      input: string,
      init?: RequestInit,
    ): Promise<Response> => {
      if (new URL(input).pathname === "/") {
        return response("Internal error", 500, {
          "content-type": "text/html",
        });
      }
      return healthyFetch(input, init);
    };

    const report = await runPublicSmoke(
      {
        baseUrl: BASE,
        expectedCommit: COMMIT,
        restaurantSlug: "k-cafe",
        menuSlug: "lunch",
      },
      brokenFetch,
    );

    expect(
      report.checks.find((check) => check.id === "homepage")?.result,
    ).toBe("FAIL");
    expect(exitCodeForReport(report)).toBe(1);
  });

  it("fails health checks when the effective security headers are wrong", async () => {
    const wrongHealthHeadersFetch = async (
      input: string,
      init?: RequestInit,
    ): Promise<Response> => {
      const path = new URL(input).pathname;
      const requestId =
        new Headers(init?.headers).get("x-request-id") ??
        "req_fake-health-1234";

      if (path === "/api/health") {
        return json({ status: "ok", commit: COMMIT }, requestId, {
          "referrer-policy": "strict-origin-when-cross-origin",
        });
      }
      if (path === "/api/health/ready") {
        return json({ status: "ready", commit: COMMIT }, requestId, {
          "referrer-policy": "strict-origin-when-cross-origin",
        });
      }
      return healthyFetch(input, init);
    };

    const report = await runPublicSmoke(
      {
        baseUrl: BASE,
        expectedCommit: COMMIT,
        restaurantSlug: "k-cafe",
        menuSlug: "lunch",
      },
      wrongHealthHeadersFetch,
    );

    expect(
      report.checks.find((check) => check.id === "health-liveness")?.result,
    ).toBe("FAIL");
    expect(
      report.checks.find((check) => check.id === "health-readiness")?.result,
    ).toBe("FAIL");
    expect(exitCodeForReport(report)).toBe(1);
  });

  it("fails when the deployed commit does not match", async () => {
    const report = await runPublicSmoke(
      {
        baseUrl: BASE,
        expectedCommit: "0".repeat(40),
        restaurantSlug: "k-cafe",
        menuSlug: "lunch",
      },
      healthyFetch,
    );

    expect(
      report.checks.find((check) => check.id === "deployment-commit")
        ?.result,
    ).toBe("FAIL");
    expect(exitCodeForReport(report)).toBe(1);
  });
});
