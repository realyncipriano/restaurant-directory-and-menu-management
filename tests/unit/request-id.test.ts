import { describe, expect, it } from "vitest";

import {
  REQUEST_ID_HEADER,
  createRequestId,
  isRequestId,
  requestIdFromHeaders,
} from "@/lib/observability/request-id";

function headers(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  };
}

describe("request IDs", () => {
  it("generates unique, prefixed IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createRequestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id.startsWith("req_")).toBe(true);
      expect(isRequestId(id)).toBe(true);
    }
  });

  it("rejects short, malformed, and oversized values", () => {
    expect(isRequestId(null)).toBe(false);
    expect(isRequestId("short")).toBe(false);
    expect(isRequestId("has a space")).toBe(false);
    expect(isRequestId("bad\nvalue123")).toBe(false);
    expect(isRequestId(`req_${"a".repeat(130)}`)).toBe(false);
  });

  it("reuses a valid inbound correlation ID", () => {
    const value = "req_upstream-1234";
    expect(requestIdFromHeaders(headers({ [REQUEST_ID_HEADER]: value }))).toBe(
      value,
    );
  });

  it("generates a replacement when the inbound value is invalid", () => {
    const generated = requestIdFromHeaders(
      headers({ [REQUEST_ID_HEADER]: "not valid" }),
    );
    expect(generated).not.toBe("not valid");
    expect(isRequestId(generated)).toBe(true);
  });
});
