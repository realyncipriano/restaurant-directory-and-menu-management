import type { DbClient } from "../../src/db/client";
import {
  appSettings,
  auditLogs,
  authTokens,
  menuCategories,
  menuChangeLogs,
  menuImportItems,
  menuImportPages,
  menuImports,
  menuItemModifiers,
  menuItemVariants,
  menuItems,
  menus,
  mfaChallenges,
  mfaRecoveryCodes,
  rateLimits,
  restaurantUserPermissions,
  restaurants,
  sessions,
  users,
} from "../../src/db/schema";

export const RESTORE_DRILL_CREATED_AT = new Date("2026-01-15T12:00:00.123Z");
const LATER = new Date("2026-02-01T08:30:00.000Z");
const LOGICAL_ID = "00000000-0000-4000-8000-000000000001";
const MATCHED_LOGICAL_ID = "00000000-0000-4000-8000-000000000002";
const LINEAGE_ID = "00000000-0000-4000-8000-000000000010";

/**
 * Seeds a disposable database with at least one row in every application
 * table, including both self-referencing columns. The data is synthetic and
 * safe to log; no real credentials or user records are used.
 */
export async function seedRestoreDrillData(db: DbClient): Promise<void> {
  const [admin, editor] = await db
    .insert(users)
    .values([
      {
        name: "Drill Administrator",
        email: "drill-admin@example.invalid",
        passwordHash: "$argon2id$v=19$drill-only-hash",
        role: "admin",
        accountStatus: "active",
        lastLoginAt: RESTORE_DRILL_CREATED_AT,
        mfaEnabledAt: RESTORE_DRILL_CREATED_AT,
        mfaTotpSecret: "drill-encrypted-totp-secret",
        mfaLastUsedStep: 42,
        createdAt: RESTORE_DRILL_CREATED_AT,
        updatedAt: RESTORE_DRILL_CREATED_AT,
      },
      {
        name: "Drill Editor",
        email: "drill-editor@example.invalid",
        passwordHash: null,
        role: "authorized_user",
        accountStatus: "invited",
        createdAt: RESTORE_DRILL_CREATED_AT,
        updatedAt: LATER,
      },
    ])
    .returning();
  if (!admin || !editor) throw new Error("Drill user seed failed.");

  const [restaurant] = await db
    .insert(restaurants)
    .values({
      name: "Drill Restaurant",
      slug: "drill-restaurant",
      description: "Ephemeral data for the restore drill.",
      cuisineType: "Filipino",
      address: "1 Drill Street",
      location: "Manila",
      contactPhone: "+63 2 0000 0000",
      contactEmail: "hello@example.invalid",
      operatingHours: "09:00-21:00",
      currency: "PHP",
      logoObjectKey: "drill/logo.png",
      coverObjectKey: "drill/cover.png",
      status: "active",
      archivedAt: null,
      createdBy: admin.id,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: RESTORE_DRILL_CREATED_AT,
    })
    .returning();
  if (!restaurant) throw new Error("Drill restaurant seed failed.");

  await db.insert(restaurantUserPermissions).values({
    restaurantId: restaurant.id,
    userId: editor.id,
    canViewManagementData: true,
    canEditMenu: true,
    canPublishMenu: false,
    canManageRestaurant: false,
    createdAt: RESTORE_DRILL_CREATED_AT,
    updatedAt: RESTORE_DRILL_CREATED_AT,
  });

  const [publishedMenu] = await db
    .insert(menus)
    .values({
      restaurantId: restaurant.id,
      title: "Drill Menu",
      slug: "drill-menu",
      description: "Published baseline.",
      status: "published",
      lineageId: LINEAGE_ID,
      version: 1,
      publishedAt: RESTORE_DRILL_CREATED_AT,
      lastUpdatedAt: RESTORE_DRILL_CREATED_AT,
      createdBy: admin.id,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: RESTORE_DRILL_CREATED_AT,
    })
    .returning();
  if (!publishedMenu) throw new Error("Drill menu seed failed.");

  const [draftMenu] = await db
    .insert(menus)
    .values({
      restaurantId: restaurant.id,
      title: "Drill Menu Draft",
      slug: "drill-menu-draft",
      description: "Cloned working copy.",
      status: "draft",
      lineageId: LINEAGE_ID,
      version: 2,
      clonedFromMenuId: publishedMenu.id,
      createdBy: editor.id,
      createdAt: LATER,
      updatedAt: LATER,
    })
    .returning();
  if (!draftMenu) throw new Error("Drill menu clone seed failed.");

  const [category] = await db
    .insert(menuCategories)
    .values({
      menuId: draftMenu.id,
      name: "Mains",
      description: "Main dishes",
      sortOrder: 0,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: RESTORE_DRILL_CREATED_AT,
    })
    .returning();
  if (!category) throw new Error("Drill category seed failed.");

  const [item] = await db
    .insert(menuItems)
    .values({
      categoryId: category.id,
      logicalId: LOGICAL_ID,
      name: "Drill Adobo",
      description: "A dish that exists only for the drill.",
      basePriceMinor: 29900,
      currency: "PHP",
      imageObjectKey: "drill/adobo.png",
      availabilityStatus: "available",
      sortOrder: 0,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: RESTORE_DRILL_CREATED_AT,
    })
    .returning();
  if (!item) throw new Error("Drill menu item seed failed.");

  await db.insert(menuItemVariants).values([
    {
      menuItemId: item.id,
      name: "Regular",
      priceMinor: 29900,
      sortOrder: 0,
      createdAt: RESTORE_DRILL_CREATED_AT,
    },
    {
      menuItemId: item.id,
      name: "Large",
      priceMinor: 39900,
      sortOrder: 1,
      createdAt: RESTORE_DRILL_CREATED_AT,
    },
  ]);

  await db.insert(menuItemModifiers).values({
    menuItemId: item.id,
    name: "Extra sauce",
    additionalPriceMinor: 2000,
    isAvailable: true,
    sortOrder: 0,
    createdAt: RESTORE_DRILL_CREATED_AT,
  });

  const [menuImport] = await db
    .insert(menuImports)
    .values({
      restaurantId: restaurant.id,
      menuId: draftMenu.id,
      uploadedBy: editor.id,
      reviewedBy: admin.id,
      status: "applied",
      extractionProvider: "drill",
      errorDetails: { warning: "none" },
      attemptCount: 1,
      lastAttemptAt: RESTORE_DRILL_CREATED_AT,
      uploadCompletedAt: RESTORE_DRILL_CREATED_AT,
      reviewedAt: LATER,
      appliedAt: LATER,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: LATER,
    })
    .returning();
  if (!menuImport) throw new Error("Drill import seed failed.");

  await db.insert(menuImportPages).values({
    importId: menuImport.id,
    pageNumber: 1,
    privateSourceObjectKey: "drill/private/page-1.png",
    mimeType: "image/png",
    sizeBytes: 128000,
    processingStatus: "processed",
    extractionMetadata: {
      provider: "drill",
      model: "drill-model",
      confidence: 0.98,
      warnings: [],
      // A scalar JSON string exercises JSONB binding fidelity on restore.
      raw: "drill-scalar-json",
      extractedAt: RESTORE_DRILL_CREATED_AT.toISOString(),
    },
    createdAt: RESTORE_DRILL_CREATED_AT,
    updatedAt: RESTORE_DRILL_CREATED_AT,
  });

  const [firstImportItem] = await db
    .insert(menuImportItems)
    .values({
      importId: menuImport.id,
      pageNumber: 1,
      categoryName: "Mains",
      name: "Drill Adobo",
      description: "Imported drill item.",
      basePriceMinor: 29900,
      currency: "PHP",
      variants: [{ name: "Regular", priceMinor: 29900 }],
      modifiers: [
        { name: "Extra sauce", additionalPriceMinor: 2000, isAvailable: true },
      ],
      availabilityStatus: "available",
      confidence: 98,
      needsReview: false,
      matchedMenuItemId: item.id,
      matchedLogicalId: MATCHED_LOGICAL_ID,
      changeType: "new",
      decision: "accept",
      sortOrder: 0,
      createdAt: RESTORE_DRILL_CREATED_AT,
      updatedAt: RESTORE_DRILL_CREATED_AT,
    })
    .returning();
  if (!firstImportItem) throw new Error("Drill import item seed failed.");

  await db.insert(menuImportItems).values({
    importId: menuImport.id,
    pageNumber: 1,
    categoryName: "Mains",
    name: "Drill Adobo Duplicate",
    description: null,
    basePriceMinor: 29900,
    currency: "PHP",
    variants: [],
    modifiers: [],
    availabilityStatus: "available",
    confidence: 90,
    needsReview: true,
    duplicateOfImportItemId: firstImportItem.id,
    matchedMenuItemId: null,
    matchedLogicalId: null,
    changeType: "unchanged",
    decision: "pending",
    sortOrder: 1,
    createdAt: RESTORE_DRILL_CREATED_AT,
    updatedAt: RESTORE_DRILL_CREATED_AT,
  });

  await db.insert(menuChangeLogs).values({
    restaurantId: restaurant.id,
    menuId: draftMenu.id,
    menuItemId: item.id,
    menuItemLogicalId: LOGICAL_ID,
    action: "item_updated",
    previousValues: { name: "Old Adobo", basePriceMinor: 27900 },
    newValues: { name: "Drill Adobo", basePriceMinor: 29900 },
    changedBy: admin.id,
    importId: menuImport.id,
    createdAt: LATER,
  });

  await db.insert(appSettings).values({
    key: "site.name",
    value: "Drill Directory",
    updatedBy: admin.id,
    updatedAt: LATER,
  });

  await db.insert(auditLogs).values({
    actorId: admin.id,
    actorEmail: admin.email,
    action: "settings_updated",
    entityType: "app_settings",
    entityId: "site.name",
    details: {
      note: "drill",
      nested: { values: [1, "two", true, null] },
    },
    createdAt: LATER,
  });

  await db.insert(authTokens).values({
    userId: editor.id,
    purpose: "invite",
    tokenHash: "drill-auth-token-hash-0001",
    expiresAt: LATER,
    usedAt: RESTORE_DRILL_CREATED_AT,
    createdBy: admin.id,
    createdAt: RESTORE_DRILL_CREATED_AT,
  });

  await db.insert(mfaChallenges).values({
    userId: admin.id,
    tokenHash: "drill-mfa-challenge-hash-0001",
    expiresAt: LATER,
    usedAt: RESTORE_DRILL_CREATED_AT,
    createdAt: RESTORE_DRILL_CREATED_AT,
  });

  await db.insert(mfaRecoveryCodes).values({
    userId: admin.id,
    codeHash: "drill-recovery-code-hash-0001",
    usedAt: null,
    createdAt: RESTORE_DRILL_CREATED_AT,
  });

  await db.insert(rateLimits).values({
    key: "login:drill-admin@example.invalid",
    count: 1,
    windowEndsAt: LATER,
    createdAt: RESTORE_DRILL_CREATED_AT,
    updatedAt: RESTORE_DRILL_CREATED_AT,
  });

  await db.insert(sessions).values({
    tokenHash: "drill-session-token-hash-0001",
    userId: admin.id,
    expiresAt: LATER,
    lastUsedAt: RESTORE_DRILL_CREATED_AT,
    steppedUpAt: RESTORE_DRILL_CREATED_AT,
    revokedAt: null,
    ipHash: "drill-ip-hash",
    userAgent: "restore-drill",
    createdAt: RESTORE_DRILL_CREATED_AT,
  });
}
