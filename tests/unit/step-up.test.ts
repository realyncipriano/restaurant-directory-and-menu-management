import { describe, expect, it } from "vitest";

import { STEP_UP_TTL_SECONDS } from "@/lib/auth/constants";
import { isStepUpFresh, safeStepUpNext } from "@/lib/auth/step-up";

const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("step-up freshness", () => {
  it("treats a missing timestamp as stale", () => {
    expect(isStepUpFresh(null, NOW)).toBe(false);
    expect(isStepUpFresh(undefined, NOW)).toBe(false);
  });

  it("stays fresh inside the window and expires exactly at the boundary", () => {
    const ttlMs = STEP_UP_TTL_SECONDS * 1000;

    expect(isStepUpFresh(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(isStepUpFresh(new Date(NOW.getTime() - ttlMs + 1), NOW)).toBe(true);
    expect(isStepUpFresh(new Date(NOW.getTime() - ttlMs), NOW)).toBe(false);
    expect(isStepUpFresh(new Date(NOW.getTime() - ttlMs - 1), NOW)).toBe(false);
  });

  it("does not treat a timestamp from the future as stale", () => {
    expect(isStepUpFresh(new Date(NOW.getTime() + 1_000), NOW)).toBe(true);
  });
});

describe("step-up return paths", () => {
  it("keeps safe internal paths", () => {
    expect(safeStepUpNext("/dashboard/users?filter=active")).toBe(
      "/dashboard/users?filter=active",
    );
    expect(safeStepUpNext(undefined)).toBe("/dashboard");
  });

  it("avoids a redirect loop when the return path is step-up itself", () => {
    expect(safeStepUpNext("/dashboard/step-up")).toBe("/dashboard");
    expect(safeStepUpNext("/dashboard/step-up?next=/dashboard/users")).toBe(
      "/dashboard",
    );
    expect(safeStepUpNext("/dashboard/step-up#form")).toBe("/dashboard");
  });

  it("rejects external return paths", () => {
    expect(safeStepUpNext("https://evil.example/dashboard")).toBe("/dashboard");
    expect(safeStepUpNext("//evil.example/dashboard")).toBe("/dashboard");
    expect(safeStepUpNext("/login")).toBe("/dashboard");
  });
});
