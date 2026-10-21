import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/action-state";
import {
  ALL_PERMISSIONS,
  canAccessDashboard,
  hasRestaurantPermission,
  normalizePermissionFlags,
} from "@/lib/auth/permissions";

describe("permission helpers", () => {
  it("gives administrators every permission regardless of scoped flags", () => {
    for (const permission of [
      "viewManagement",
      "editMenu",
      "publishMenu",
      "manageRestaurant",
    ] as const) {
      expect(hasRestaurantPermission("admin", null, permission)).toBe(true);
    }
    expect(canAccessDashboard("admin", null)).toBe(true);
  });

  it("requires at least view access for authorized users", () => {
    const flags = normalizePermissionFlags({
      canViewManagementData: true,
      canEditMenu: true,
    });

    expect(hasRestaurantPermission("authorized_user", flags, "editMenu")).toBe(
      true,
    );
    expect(
      hasRestaurantPermission("authorized_user", flags, "publishMenu"),
    ).toBe(false);
    expect(
      hasRestaurantPermission("authorized_user", flags, "manageRestaurant"),
    ).toBe(false);
    expect(
      hasRestaurantPermission(
        "authorized_user",
        { ...flags, canViewManagementData: false },
        "viewManagement",
      ),
    ).toBe(false);
  });

  it("normalizes flags so view access is always required", () => {
    expect(
      normalizePermissionFlags({
        canViewManagementData: false,
        canManageRestaurant: true,
      }),
    ).toEqual({
      canViewManagementData: true,
      canEditMenu: false,
      canPublishMenu: false,
      canManageRestaurant: true,
    });

    expect(ALL_PERMISSIONS.canPublishMenu).toBe(true);
  });

  it("only allows same-origin redirect paths after sign-in", () => {
    expect(safeRedirectPath("/dashboard/restaurants")).toBe(
      "/dashboard/restaurants",
    );
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/login?next=/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/%5Cevil.example")).toBe("/dashboard");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard?tab=menus")).toBe(
      "/dashboard?tab=menus",
    );
  });
});
