import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_IDLE_TTL_SECONDS,
  MIN_SESSION_IDLE_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  getSessionIdleTtlSeconds,
} from "@/lib/auth/constants";

describe("getSessionIdleTtlSeconds", () => {
  it("defaults to 24 hours", () => {
    expect(getSessionIdleTtlSeconds({})).toBe(
      DEFAULT_SESSION_IDLE_TTL_SECONDS,
    );
    expect(DEFAULT_SESSION_IDLE_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("reads a configured value in minutes", () => {
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "60" }),
    ).toBe(60 * 60);
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: " 1440 " }),
    ).toBe(24 * 60 * 60);
  });

  it("clamps to the supported range and the absolute lifetime", () => {
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "1" }),
    ).toBe(MIN_SESSION_IDLE_TTL_SECONDS);
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "20000" }),
    ).toBe(SESSION_TTL_SECONDS);
  });

  it("falls back for invalid values", () => {
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "30abc" }),
    ).toBe(DEFAULT_SESSION_IDLE_TTL_SECONDS);
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "-30" }),
    ).toBe(DEFAULT_SESSION_IDLE_TTL_SECONDS);
    expect(
      getSessionIdleTtlSeconds({ SESSION_IDLE_TIMEOUT_MINUTES: "" }),
    ).toBe(DEFAULT_SESSION_IDLE_TTL_SECONDS);
  });
});
