import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/health", () => ({
  probeDatabaseReadiness: probe,
}));

import { GET as liveness } from "@/app/api/health/route";
import { GET as readiness } from "@/app/api/health/ready/route";
import { isRequestId } from "@/lib/observability/request-id";

const COMMIT = "e857ba2586e1b9085386863c1276a4b6f87e9c5f";
const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;

beforeEach(() => {
  probe.mockReset();
  probe.mockResolvedValue(undefined);
  process.env.VERCEL_GIT_COMMIT_SHA = COMMIT;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalCommit;
});

function expectHealthHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(isRequestId(response.headers.get("x-request-id"))).toBe(true);
}

describe("liveness health check", () => {
  it("responds without touching the database", async () => {
    const response = await liveness(
      new Request("http://localhost/api/health"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", commit: COMMIT });
    expect(response.headers.get("content-type")).toContain("application/json");
    expectHealthHeaders(response);
    expect(probe).not.toHaveBeenCalled();
  });

  it("preserves a valid correlation ID and replaces an invalid one", async () => {
    const forwarded = await liveness(
      new Request("http://localhost/api/health", {
        headers: { "x-request-id": "req_smoke-1234" },
      }),
    );
    expect(forwarded.headers.get("x-request-id")).toBe("req_smoke-1234");

    const replaced = await liveness(
      new Request("http://localhost/api/health", {
        headers: { "x-request-id": "not valid" },
      }),
    );
    expect(replaced.headers.get("x-request-id")).not.toBe("not valid");
    expect(isRequestId(replaced.headers.get("x-request-id"))).toBe(true);
  });
});

describe("readiness health check", () => {
  it("returns ready after a successful minimal database probe", async () => {
    const response = await readiness(
      new Request("http://localhost/api/health/ready"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", commit: COMMIT });
    expectHealthHeaders(response);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("returns a controlled 503 without leaking dependency details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    probe.mockRejectedValue(
      new Error(
        "connect failed for postgresql://user:password@db.example/app DATABASE_URL=secret",
      ),
    );

    const response = await readiness(
      new Request("http://localhost/api/health/ready"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "unavailable" });
    expect(body).not.toContain("postgres");
    expect(body).not.toContain("password");
    expect(body).not.toContain("DATABASE_URL");
    expectHealthHeaders(response);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("health.readiness_failed");
    expect(logged).not.toContain("user:password");
    expect(logged).not.toContain("postgresql://");
    expect(logged).not.toContain("DATABASE_URL=secret");
  });
});
