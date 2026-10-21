import { afterEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => headersMock);

import { hashIdentifier } from "@/lib/auth/tokens";
import { getRequestMeta } from "@/lib/request-meta";

function headerStore(values: Record<string, string>) {
  return {
    get: (key: string) => values[key.toLowerCase()] ?? null,
  };
}

describe("request metadata", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    headersMock.headers.mockReset();
  });

  it("ignores forwarded headers by default", async () => {
    headersMock.headers.mockResolvedValue(
      headerStore({
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "203.0.113.10",
      }),
    );

    const meta = await getRequestMeta();

    expect(meta.ipHash).toBeNull();
  });

  it("hashes the first forwarded address in Vercel mode", async () => {
    process.env.TRUST_PROXY = "vercel";
    headersMock.headers.mockResolvedValue(
      headerStore({
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      }),
    );

    const meta = await getRequestMeta();

    expect(meta.ipHash).toBe(hashIdentifier("ip:203.0.113.10"));
  });

  it("falls back to x-real-ip for a trusted proxy", async () => {
    process.env.TRUST_PROXY = "proxy";
    headersMock.headers.mockResolvedValue(
      headerStore({ "x-real-ip": "198.51.100.20" }),
    );

    const meta = await getRequestMeta();

    expect(meta.ipHash).toBe(hashIdentifier("ip:198.51.100.20"));
  });

  it("ignores forwarded headers for an unknown mode", async () => {
    process.env.TRUST_PROXY = "unexpected";
    headersMock.headers.mockResolvedValue(
      headerStore({ "x-forwarded-for": "203.0.113.10" }),
    );

    const meta = await getRequestMeta();

    expect(meta.ipHash).toBeNull();
  });
});
