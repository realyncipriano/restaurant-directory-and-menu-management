import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "authorized_user"]);

export const accountStatusEnum = pgEnum("account_status", [
  "invited",
  "active",
  "deactivated",
]);

export const authTokenPurposeEnum = pgEnum("auth_token_purpose", [
  "invite",
  "password_reset",
]);

export const restaurantStatusEnum = pgEnum("restaurant_status", [
  "active",
  "archived",
]);

export const menuStatusEnum = pgEnum("menu_status", [
  "draft",
  "published",
  "archived",
]);

export const availabilityStatusEnum = pgEnum("availability_status", [
  "available",
  "unavailable",
]);

export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "processing",
  "needs_review",
  "reviewed",
  "applied",
  "failed",
]);

export const importPageStatusEnum = pgEnum("import_page_status", [
  "pending",
  "uploaded",
  "processing",
  "processed",
  "failed",
]);

export const importItemDecisionEnum = pgEnum("import_item_decision", [
  "pending",
  "accept",
  "reject",
]);

export const importChangeTypeEnum = pgEnum("import_change_type", [
  "new",
  "renamed",
  "description_changed",
  "price_changed",
  "availability_changed",
  "unchanged",
  "removed",
]);

export const changeActionEnum = pgEnum("change_action", [
  "restaurant_created",
  "restaurant_updated",
  "restaurant_archived",
  "restaurant_activated",
  "menu_created",
  "menu_duplicated",
  "menu_updated",
  "menu_published",
  "menu_unpublished",
  "menu_archived",
  "category_created",
  "category_updated",
  "category_deleted",
  "item_created",
  "item_updated",
  "item_deleted",
  "item_availability_changed",
  "price_changed",
  "import_applied",
  "permission_granted",
  "permission_revoked",
  "user_invited",
  "user_activated",
  "user_deactivated",
  "user_reactivated",
  "settings_updated",
]);
