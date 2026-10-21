import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  availabilityStatusEnum,
  changeActionEnum,
  importChangeTypeEnum,
  importItemDecisionEnum,
  importPageStatusEnum,
  importStatusEnum,
} from "./enums";
import { menuItems, menus } from "./menus";
import { restaurants } from "./restaurants";
import { users } from "./users";

export type ImportedVariant = {
  name: string;
  priceMinor: number | null;
};

export type ImportedModifier = {
  name: string;
  additionalPriceMinor: number | null;
  isAvailable: boolean;
};

export type ExtractionMetadata = {
  provider?: string;
  model?: string;
  raw?: unknown;
  confidence?: number;
  warnings?: string[];
  error?: string;
  extractedAt?: string;
};

export const menuImports = pgTable(
  "menu_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id").references(() => menus.id, {
      onDelete: "set null",
    }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: importStatusEnum("status").notNull().default("uploaded"),
    extractionProvider: text("extraction_provider"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    processingToken: uuid("processing_token"),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    uploadCompletedAt: timestamp("upload_completed_at", {
      withTimezone: true,
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_imports_restaurant_status_idx").on(
      table.restaurantId,
      table.status,
    ),
    index("menu_imports_created_idx").on(table.createdAt),
  ],
);

export const menuImportPages = pgTable(
  "menu_import_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => menuImports.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    privateSourceObjectKey: text("private_source_object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    processingStatus: importPageStatusEnum("processing_status")
      .notNull()
      .default("pending"),
    extractionMetadata: jsonb("extraction_metadata").$type<ExtractionMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("menu_import_pages_import_page_unique").on(
      table.importId,
      table.pageNumber,
    ),
    check("menu_import_pages_page_positive", sql`${table.pageNumber} >= 1`),
    check("menu_import_pages_size_positive", sql`${table.sizeBytes} >= 0`),
  ],
);

export const menuImportItems = pgTable(
  "menu_import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => menuImports.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number"),
    categoryName: text("category_name").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    basePriceMinor: integer("base_price_minor"),
    currency: text("currency").notNull().default("PHP"),
    variants: jsonb("variants")
      .$type<ImportedVariant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    modifiers: jsonb("modifiers")
      .$type<ImportedModifier[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    availabilityStatus: availabilityStatusEnum("availability_status")
      .notNull()
      .default("available"),
    confidence: integer("confidence"),
    needsReview: boolean("needs_review").notNull().default(false),
    duplicateOfImportItemId: uuid("duplicate_of_import_item_id").references(
      (): AnyPgColumn => menuImportItems.id,
      { onDelete: "set null" },
    ),
    matchedMenuItemId: uuid("matched_menu_item_id").references(
      () => menuItems.id,
      { onDelete: "set null" },
    ),
    matchedLogicalId: uuid("matched_logical_id"),
    changeType: importChangeTypeEnum("change_type")
      .notNull()
      .default("new"),
    decision: importItemDecisionEnum("decision").notNull().default("pending"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_import_items_import_sort_idx").on(
      table.importId,
      table.sortOrder,
    ),
    check(
      "menu_import_items_confidence_range",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 100)`,
    ),
    check(
      "menu_import_items_price_non_negative",
      sql`${table.basePriceMinor} IS NULL OR ${table.basePriceMinor} >= 0`,
    ),
    check("menu_import_items_sort_non_negative", sql`${table.sortOrder} >= 0`),
  ],
);

export const menuChangeLogs = pgTable(
  "menu_change_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id").references(() => menus.id, {
      onDelete: "set null",
    }),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id, {
      onDelete: "set null",
    }),
    menuItemLogicalId: uuid("menu_item_logical_id"),
    action: changeActionEnum("action").notNull(),
    previousValues: jsonb("previous_values").$type<Record<
      string,
      unknown
    > | null>(),
    newValues: jsonb("new_values").$type<Record<string, unknown> | null>(),
    changedBy: uuid("changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    importId: uuid("import_id").references(() => menuImports.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("menu_change_logs_restaurant_created_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
    index("menu_change_logs_menu_created_idx").on(
      table.menuId,
      table.createdAt,
    ),
    index("menu_change_logs_logical_created_idx").on(
      table.menuItemLogicalId,
      table.createdAt,
    ),
  ],
);
