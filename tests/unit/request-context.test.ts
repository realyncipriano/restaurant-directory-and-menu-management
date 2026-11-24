import { describe, expect, it } from "vitest";

import {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
} from "@/lib/observability/request-context";

describe("request context", () => {
  it("exposes the correlation ID inside the callback only", () => {
    expect(getRequestId()).toBeNull();
    expect(getRequestContext()).toBeUndefined();

    const result = runWithRequestContext(
      { requestId: "req_test-1234", route: "/dashboard" },
      () => ({
        requestId: getRequestId(),
        context: getRequestContext(),
      }),
    );

    expect(result.requestId).toBe("req_test-1234");
    expect(result.context).toEqual({
      requestId: "req_test-1234",
      route: "/dashboard",
    });
    expect(getRequestId()).toBeNull();
  });

  it("keeps nested contexts isolated", () => {
    runWithRequestContext({ requestId: "req_outer-1234" }, () => {
      expect(getRequestId()).toBe("req_outer-1234");

      runWithRequestContext({ requestId: "req_inner-1234" }, () => {
        expect(getRequestId()).toBe("req_inner-1234");
      });

      expect(getRequestId()).toBe("req_outer-1234");
    });
  });
});
