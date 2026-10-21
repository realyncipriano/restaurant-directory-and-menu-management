import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { availabilityStatusEnum, menuStatusEnum } from "./enums";
import { restaurants } from "./restaurants";
import { users } from "./users";

export const menus = pgTable(
  "menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: menuStatusEnum("status").notNull().default("draft"),
    lineageId: uuid("lineage_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    clonedFromMenuId: uuid("cloned_from_menu_id").references(
      (): AnyPgColumn => menus.id,
      { onDelete: "set null" },
    ),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
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
    uniqueIndex("menus_restaurant_lineage_version_unique").on(
      table.restaurantId,
      table.lineageId,
      table.version,
    ),
    uniqueIndex("menus_published_slug_unique")
      .on(table.restaurantId, table.slug)
      .where(sql`${table.status} = 'published'`),
    uniqueIndex("menus_published_lineage_unique")
      .on(table.restaurantId, table.lineageId)
      .where(sql`${table.status} = 'published'`),
    uniqueIndex("menus_draft_lineage_unique")
      .on(table.restaurantId, table.lineageId)
      .where(sql`${table.status} = 'draft'`),
    index("menus_restaurant_status_idx").on(table.restaurantId, table.status),
    index("menus_lineage_idx").on(table.lineageId),
    check("menus_version_positive", sql`${table.version} >= 1`),
    check(
      "menus_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_categories_menu_sort_idx").on(table.menuId, table.sortOrder),
    uniqueIndex("menu_categories_menu_name_unique").on(
      table.menuId,
      sql`lower(${table.name})`,
    ),
    check("menu_categories_sort_non_negative", sql`${table.sortOrder} >= 0`),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "cascade" }),
    logicalId: uuid("logical_id").notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    basePriceMinor: integer("base_price_minor"),
    currency: text("currency").notNull().default("PHP"),
    imageObjectKey: text("image_object_key"),
    availabilityStatus: availabilityStatusEnum("availability_status")
      .notNull()
      .default("available"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_items_category_sort_idx").on(table.categoryId, table.sortOrder),
    index("menu_items_logical_idx").on(table.logicalId),
    check(
      "menu_items_base_price_non_negative",
      sql`${table.basePriceMinor} IS NULL OR ${table.basePriceMinor} >= 0`,
    ),
    check(
      "menu_items_currency_format",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check("menu_items_sort_non_negative", sql`${table.sortOrder} >= 0`),
  ],
);

export const menuItemVariants = pgTable(
  "menu_item_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: integer("price_minor").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_item_variants_item_sort_idx").on(
      table.menuItemId,
      table.sortOrder,
    ),
    check(
      "menu_item_variants_price_non_negative",
      sql`${table.priceMinor} >= 0`,
    ),
  ],
);

export const menuItemModifiers = pgTable(
  "menu_item_modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    additionalPriceMinor: integer("additional_price_minor")
      .notNull()
      .default(0),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_item_modifiers_item_sort_idx").on(
      table.menuItemId,
      table.sortOrder,
    ),
    check(
      "menu_item_modifiers_price_non_negative",
      sql`${table.additionalPriceMinor} >= 0`,
    ),
  ],
);
