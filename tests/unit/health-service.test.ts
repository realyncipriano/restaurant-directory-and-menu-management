import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: mocks.getDb,
}));

import {
  READINESS_STATEMENT_TIMEOUT_MS,
  READINESS_TIMEOUT_MS,
  ReadinessTimeoutError,
  probeDatabaseReadiness,
} from "@/server/services/health";

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue(undefined);
  mocks.transaction.mockReset();
  mocks.getDb.mockReset().mockReturnValue({
    transaction: mocks.transaction,
  });
  mocks.transaction.mockImplementation(
    async (
      callback: (tx: { execute: typeof mocks.execute }) => Promise<void>,
    ) => callback({ execute: mocks.execute }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readiness database probe", () => {
  it("runs the probe in a transaction with a tighter statement timeout", async () => {
    await probeDatabaseReadiness();

    expect(READINESS_STATEMENT_TIMEOUT_MS).toBeLessThan(
      READINESS_TIMEOUT_MS,
    );
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("clears the response deadline after a successful probe", async () => {
    vi.useFakeTimers();

    await probeDatabaseReadiness();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out when the probe does not settle", async () => {
    vi.useFakeTimers();
    mocks.transaction.mockReturnValue(new Promise<void>(() => {}));

    const result = probeDatabaseReadiness();
    const assertion = expect(result).rejects.toBeInstanceOf(
      ReadinessTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a database failure", async () => {
    mocks.transaction.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(probeDatabaseReadiness()).rejects.toThrow(
      "database unavailable",
    );
  });
});
