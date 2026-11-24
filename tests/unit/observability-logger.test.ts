import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sanitizeDbError } from "@/db/pool-errors";
import { ForbiddenError } from "@/lib/errors";
import {
  classifyError,
  logger,
  serializeError,
} from "@/lib/observability/logger";

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const originalLogLevel = process.env.LOG_LEVEL;
const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;

function lastRecord(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(String(call?.[0])) as Record<string, unknown>;
}

function drizzleQueryError(
  cause: unknown,
  param = "secret-menu-name",
): Error {
  return Object.assign(
    new Error(
      `Failed query: select * from menus where name = $1\nparams: ${param}`,
    ),
    {
      query: "select * from menus where name = $1",
      params: [param],
      cause,
    },
  );
}

beforeEach(() => {
  process.env.LOG_LEVEL = "debug";
  process.env.VERCEL_GIT_COMMIT_SHA = "e857ba2586e1b9085386863c1276a4b6f87e9c5f";
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
  if (originalCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalCommit;
});

describe("structured logger", () => {
  it("writes one JSON record with stable fields", () => {
    logger.info("test.started", {
      requestId: "req_test-1234",
      message: "A safe message.",
      context: { route: "/dashboard", attempt: 2 },
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const record = lastRecord(logSpy);
    expect(record.level).toBe("info");
    expect(record.service).toBe("restaurant-directory");
    expect(record.event).toBe("test.started");
    expect(record.requestId).toBe("req_test-1234");
    expect(record.release).toBe(
      "e857ba2586e1b9085386863c1276a4b6f87e9c5f",
    );
    expect(record.context).toEqual({ route: "/dashboard", attempt: 2 });
    expect(typeof record.timestamp).toBe("string");
  });

  it("omits invalid correlation values", () => {
    logger.info("test.invalid-request-id", {
      requestId: "not a valid id",
    });

    expect(lastRecord(logSpy).requestId).toBeUndefined();
  });

  it("honours LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";

    logger.info("test.hidden");
    logger.warn("test.visible");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(lastRecord(warnSpy).event).toBe("test.visible");
  });

  it("redacts secrets from messages, errors, and nested context", () => {
    logger.error("test.redaction", {
      requestId: "req_test-1234",
      error: new Error(
        "connect postgresql://alice:supersecret@db.example/app password=supersecret",
      ),
      context: {
        password: "hunter2",
        nested: {
          authorization: "Bearer abc.def.ghi",
          cookie: "rdmm_session=session-value",
        },
        note: "Authorization: Bearer abc.def.ghi; token=xyz",
      },
    });

    const raw = String(errorSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("supersecret");
    expect(raw).not.toContain("alice:");
    expect(raw).not.toContain("abc.def.ghi");
    expect(raw).not.toContain("session-value");
    expect(raw).not.toContain("token=xyz");

    const record = lastRecord(errorSpy);
    expect(record.error).toMatchObject({ category: "unknown" });
    expect(JSON.stringify(record.error)).toContain(
      "[redacted-connection-string]",
    );
    expect(record.context).toMatchObject({
      password: "[redacted]",
      nested: {
        authorization: "[redacted]",
        cookie: "[redacted]",
      },
    });
    expect(String((record.context as Record<string, unknown>).note)).not.toContain(
      "xyz",
    );
  });

  it("survives circular context without throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() =>
      logger.info("test.circular", { context: { circular } }),
    ).not.toThrow();
    expect(JSON.stringify(lastRecord(logSpy))).toContain("[circular]");
  });

  it("emits a safe fallback instead of throwing when the writer fails", () => {
    logSpy.mockImplementation(() => {
      throw new Error("console unavailable");
    });

    expect(() => logger.info("test.write-failure")).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(lastRecord(errorSpy)).toMatchObject({
      level: "error",
      event: "logging.failed",
    });
  });

  it("does not throw when the fallback writer also fails", () => {
    logSpy.mockImplementation(() => {
      throw new Error("console unavailable");
    });
    errorSpy.mockImplementation(() => {
      throw new Error("error console unavailable");
    });

    expect(() => logger.info("test.total-logging-failure")).not.toThrow();
  });

  it("does not throw when log context cannot be inspected", () => {
    const context: Record<string, unknown> = {};
    Object.defineProperty(context, "broken", {
      enumerable: true,
      get() {
        throw new Error("getter failed");
      },
    });

    expect(() =>
      logger.info("test.context-failure", { context }),
    ).not.toThrow();
    expect(lastRecord(errorSpy).event).toBe("logging.failed");
  });

  it("logs only the Drizzle cause without query text or parameters", () => {
    const error = drizzleQueryError(
      Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
      }),
    );

    logger.error("test.drizzle-error", { error });

    const raw = String(errorSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain("Failed query");
    expect(raw).not.toContain("select * from menus");
    expect(raw).not.toContain("secret-menu-name");
    expect(lastRecord(errorSpy).error).toMatchObject({
      name: "DrizzleQueryError",
      category: "network",
      code: "ECONNREFUSED",
      message: "connection refused",
    });
  });

  it("can suppress error details while keeping classification", () => {
    const serialized = serializeError(
      new Error("secret-restaurant postgres://user:pass@host/db"),
      { includeMessage: false, includeStack: false },
    );

    expect(serialized).toMatchObject({
      name: "Error",
      category: "unknown",
    });
    expect(serialized?.message).toBeUndefined();
    expect(serialized?.stack).toBeUndefined();
  });
});

describe("error classification", () => {
  it("classifies Drizzle query errors from their underlying cause", () => {
    expect(
      classifyError(
        drizzleQueryError(
          Object.assign(new Error("db unavailable"), { code: "08006" }),
        ),
      ),
    ).toBe("database");
    expect(
      classifyError(
        drizzleQueryError(
          Object.assign(new Error("slow query"), { name: "TimeoutError" }),
        ),
      ),
    ).toBe("timeout");
  });

  it("suppresses Drizzle query details when no cause is available", () => {
    const serialized = serializeError(drizzleQueryError(undefined));

    expect(serialized).toMatchObject({
      name: "DrizzleQueryError",
      category: "unknown",
    });
    expect(serialized?.message).toBeUndefined();
    expect(serialized?.stack).toBeUndefined();
  });

  it.each([
    [new ForbiddenError(), "authorization"],
    [Object.assign(new Error("db"), { code: "23505" }), "conflict"],
    [Object.assign(new Error("db"), { name: "NeonDbError" }), "database"],
    [Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), "timeout"],
    [
      Object.assign(new Error("timeout"), { name: "ReadinessTimeoutError" }),
      "timeout",
    ],
    [
      Object.assign(new Error("network"), { code: "ECONNREFUSED" }),
      "network",
    ],
    [
      Object.assign(new Error("storage"), { name: "S3ServiceException" }),
      "storage",
    ],
    [Object.assign(new Error("remote"), { status: 503 }), "external_service"],
    [new Error("unexpected"), "unknown"],
  ])("classifies %o as %s", (error, category) => {
    expect(classifyError(error)).toBe(category);
  });
});

describe("database log sanitisation", () => {
  it("redacts connection strings and credential assignments", () => {
    const sanitized = sanitizeDbError(
      new Error(
        "failed postgresql://user:password@example/db password=secret-value",
      ),
    );

    expect(sanitized).not.toContain("postgresql://");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).toContain("[redacted-connection-string]");
  });

  it("redacts credentials embedded in ordinary URLs", () => {
    const sanitized = sanitizeDbError(
      new Error("fetch failed for https://admin:hunter2@example.test/path"),
    );

    expect(sanitized).not.toContain("admin:");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).toContain("[redacted-url-with-credentials]");
  });
});
