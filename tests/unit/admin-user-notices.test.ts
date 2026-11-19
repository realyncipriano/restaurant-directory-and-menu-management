import { describe, expect, it } from "vitest";

import {
  deactivateErrorCode,
  reactivateErrorCode,
  roleErrorCode,
} from "@/lib/admin-user-notices";

describe("administrator user-action notice codes", () => {
  it("maps every role conflict reason to a distinct code", () => {
    expect(roleErrorCode("self")).toBe("role_self");
    expect(roleErrorCode("inactive")).toBe("role_inactive");
    expect(roleErrorCode("passwordless")).toBe("role_passwordless");
    expect(roleErrorCode("last_admin")).toBe("role_last_admin");
    expect(roleErrorCode("state")).toBe("role_state");
    expect(roleErrorCode(undefined)).toBe("role_conflict");
    expect(roleErrorCode("unexpected")).toBe("role_conflict");
  });

  it("maps every deactivation conflict reason to a distinct code", () => {
    expect(deactivateErrorCode("self")).toBe("deactivate_self");
    expect(deactivateErrorCode("last_admin")).toBe("deactivate_last_admin");
    expect(deactivateErrorCode("state")).toBe("deactivate_state");
    expect(deactivateErrorCode(undefined)).toBe("conflict");
    expect(deactivateErrorCode("unexpected")).toBe("conflict");
  });

  it("maps every reactivation conflict reason to a distinct code", () => {
    expect(reactivateErrorCode("not_deactivated")).toBe("reactivate_state");
    expect(reactivateErrorCode("passwordless")).toBe(
      "reactivate_passwordless",
    );
    expect(reactivateErrorCode(undefined)).toBe("failed");
    expect(reactivateErrorCode("unexpected")).toBe("failed");
  });
});
