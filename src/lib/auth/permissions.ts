export type UserRole = "admin" | "authorized_user";

export type RestaurantPermissionFlags = {
  canViewManagementData: boolean;
  canEditMenu: boolean;
  canPublishMenu: boolean;
  canManageRestaurant: boolean;
};

export type RestaurantPermission =
  | "viewManagement"
  | "editMenu"
  | "publishMenu"
  | "manageRestaurant";

export const ALL_PERMISSIONS: RestaurantPermissionFlags = {
  canViewManagementData: true,
  canEditMenu: true,
  canPublishMenu: true,
  canManageRestaurant: true,
};

export function hasRestaurantPermission(
  role: UserRole,
  flags: RestaurantPermissionFlags | null | undefined,
  permission: RestaurantPermission,
): boolean {
  if (role === "admin") return true;
  if (!flags || !flags.canViewManagementData) return false;

  switch (permission) {
    case "viewManagement":
      return true;
    case "editMenu":
      return flags.canEditMenu;
    case "publishMenu":
      return flags.canPublishMenu;
    case "manageRestaurant":
      return flags.canManageRestaurant;
  }
}

export function canAccessDashboard(
  role: UserRole,
  flags: RestaurantPermissionFlags | null | undefined,
): boolean {
  return role === "admin" || Boolean(flags?.canViewManagementData);
}

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

export function normalizePermissionFlags(
  input: Partial<RestaurantPermissionFlags>,
): RestaurantPermissionFlags {
  return {
    canViewManagementData: true,
    canEditMenu: Boolean(input.canEditMenu),
    canPublishMenu: Boolean(input.canPublishMenu),
    canManageRestaurant: Boolean(input.canManageRestaurant),
  };
}
