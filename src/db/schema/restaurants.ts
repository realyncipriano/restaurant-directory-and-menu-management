import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { restaurantStatusEnum } from "./enums";
import { users } from "./users";

export const restaurants = pgTable(
  "restaurants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    cuisineType: text("cuisine_type"),
    address: text("address"),
    location: text("location"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    operatingHours: text("operating_hours"),
    currency: text("currency").notNull().default("PHP"),
    logoObjectKey: text("logo_object_key"),
    coverObjectKey: text("cover_object_key"),
    status: restaurantStatusEnum("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("restaurants_slug_unique").on(table.slug),
    index("restaurants_status_idx").on(table.status),
    index("restaurants_cuisine_idx").on(table.cuisineType),
    index("restaurants_location_idx").on(table.location),
    check(
      "restaurants_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "restaurants_currency_format",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const restaurantUserPermissions = pgTable(
  "restaurant_user_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canViewManagementData: boolean("can_view_management_data")
      .notNull()
      .default(true),
    canEditMenu: boolean("can_edit_menu").notNull().default(false),
    canPublishMenu: boolean("can_publish_menu").notNull().default(false),
    canManageRestaurant: boolean("can_manage_restaurant")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("restaurant_user_permissions_unique").on(
      table.restaurantId,
      table.userId,
    ),
    index("restaurant_user_permissions_user_idx").on(table.userId),
    check(
      "restaurant_user_permissions_view_required",
      sql`${table.canViewManagementData} = true`,
    ),
  ],
);
