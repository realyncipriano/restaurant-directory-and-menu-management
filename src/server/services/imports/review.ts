import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { menuImportItems, menuImports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parsePriceToMinor } from "@/lib/money";
import {
  isAcceptableImportItem,
  normalizeName,
  shouldStayPendingOnKeepOnly,
  type ImportItemRow,
} from "../import-rules";
import { requireDraftEditable } from "../menu-access";
import { lockImportForReview } from "./lock";
import { getMenuImport } from "./queries";

export async function updateImportItem(
  db: DbClient,
  actorId: string,
  importId: string,
  itemId: string,
  input: {
    decision: "pending" | "accept" | "reject";
    categoryName: string;
    name: string;
    description?: string;
    basePrice?: string;
    availabilityStatus: "available" | "unavailable";
  },
): Promise<void> {
  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  await db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const [staged] = await tx
      .select()
      .from(menuImportItems)
      .where(
        and(
          eq(menuImportItems.id, itemId),
          eq(menuImportItems.importId, importId),
        ),
      )
      .limit(1);
    if (!staged) throw new NotFoundError("Import item not found.");

    const categoryName = input.categoryName.trim();
    const name = input.name.trim();
    if (!categoryName || !name) {
      throw new ValidationError("Category and item name are required.");
    }

    const price = parsePriceToMinor(input.basePrice ?? "");
    if (!price.ok) {
      throw new ValidationError(price.message, {
        basePrice: [price.message],
      });
    }

    const now = new Date();
    await tx
      .update(menuImportItems)
      .set({
        decision: input.decision,
        categoryName: categoryName.slice(0, 120),
        name: name.slice(0, 160),
        description: input.description?.trim() || null,
        basePriceMinor: price.minor,
        availabilityStatus: input.availabilityStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(menuImportItems.id, itemId),
          eq(menuImportItems.importId, importId),
        ),
      );

    await tx
      .update(menuImports)
      .set({ updatedAt: now })
      .where(eq(menuImports.id, importId));
  });
}

export async function acceptAllImportItems(
  db: DbClient,
  actorId: string,
  importId: string,
): Promise<void> {
  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  await db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const items = await tx
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId));
    const acceptedIds = items
      .filter(isAcceptableImportItem)
      .map((item) => item.id);

    if (acceptedIds.length === 0) return;

    await tx
      .update(menuImportItems)
      .set({ decision: "accept", updatedAt: new Date() })
      .where(
        and(
          eq(menuImportItems.importId, importId),
          eq(menuImportItems.decision, "pending"),
          inArray(menuImportItems.id, acceptedIds),
        ),
      );
  });
}

export type ImportCategoryDecision = "accept" | "reject";

export type ImportCategoryDecisionResult = {
  categoryName: string;
  accepted: number;
  rejected: number;
  pending: number;
  pendingInCategory: number;
};

async function updateItemDecisions(
  tx: DbExecutor,
  importId: string,
  itemIds: string[],
  decision: ImportCategoryDecision,
  now: Date,
): Promise<void> {
  if (itemIds.length === 0) return;

  await tx
    .update(menuImportItems)
    .set({ decision, updatedAt: now })
    .where(
      and(
        eq(menuImportItems.importId, importId),
        inArray(menuImportItems.id, itemIds),
      ),
    );
}

function countPendingAfter(
  items: ImportItemRow[],
  changed: Map<string, ImportCategoryDecision>,
  categoryKey?: string,
): number {
  return items.filter((item) => {
    if (
      categoryKey !== undefined &&
      normalizeName(item.categoryName) !== categoryKey
    ) {
      return false;
    }
    return (changed.get(item.id) ?? item.decision) === "pending";
  }).length;
}

export async function updateImportCategoryDecision(
  db: DbClient,
  actorId: string,
  importId: string,
  categoryName: string,
  decision: ImportCategoryDecision,
): Promise<ImportCategoryDecisionResult> {
  const categoryKey = normalizeName(categoryName);
  if (!categoryKey) {
    throw new ValidationError("Choose a category.");
  }

  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  const now = new Date();

  return db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const items = await tx
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId));
    const categoryItems = items.filter(
      (item) => normalizeName(item.categoryName) === categoryKey,
    );
    if (categoryItems.length === 0) {
      throw new ValidationError("That category was not found in this scan.");
    }

    const changedIds =
      decision === "accept"
        ? categoryItems
            .filter(isAcceptableImportItem)
            .map((item) => item.id)
        : categoryItems
            .filter((item) => item.decision === "pending")
            .map((item) => item.id);

    await updateItemDecisions(tx, importId, changedIds, decision, now);
    await tx
      .update(menuImports)
      .set({ updatedAt: now })
      .where(eq(menuImports.id, importId));

    const changed = new Map(
      changedIds.map((itemId) => [itemId, decision] as const),
    );

    return {
      categoryName: categoryItems[0]!.categoryName,
      accepted: decision === "accept" ? changedIds.length : 0,
      rejected: decision === "reject" ? changedIds.length : 0,
      pending: countPendingAfter(items, changed),
      pendingInCategory: countPendingAfter(items, changed, categoryKey),
    };
  });
}

export async function keepOnlyImportCategory(
  db: DbClient,
  actorId: string,
  importId: string,
  categoryName: string,
): Promise<ImportCategoryDecisionResult> {
  const categoryKey = normalizeName(categoryName);
  if (!categoryKey) {
    throw new ValidationError("Choose a category.");
  }

  const data = await getMenuImport(db, actorId, importId);
  await requireDraftEditable(db, actorId, data.menu.id);

  const now = new Date();

  return db.transaction(async (tx) => {
    await lockImportForReview(tx, importId);

    const items = await tx
      .select()
      .from(menuImportItems)
      .where(eq(menuImportItems.importId, importId));
    const categoryItems = items.filter(
      (item) => normalizeName(item.categoryName) === categoryKey,
    );
    if (categoryItems.length === 0) {
      throw new ValidationError("That category was not found in this scan.");
    }

    const acceptedIds = categoryItems
      .filter(isAcceptableImportItem)
      .map((item) => item.id);
    const rejectedIds = items
      .filter((item) => normalizeName(item.categoryName) !== categoryKey)
      .filter(
        (item) =>
          item.decision === "accept" ||
          (item.decision === "pending" && !shouldStayPendingOnKeepOnly(item)),
      )
      .map((item) => item.id);

    await updateItemDecisions(tx, importId, acceptedIds, "accept", now);
    await updateItemDecisions(tx, importId, rejectedIds, "reject", now);
    await tx
      .update(menuImports)
      .set({ updatedAt: now })
      .where(eq(menuImports.id, importId));

    const changed = new Map<string, ImportCategoryDecision>([
      ...acceptedIds.map((itemId) => [itemId, "accept"] as const),
      ...rejectedIds.map((itemId) => [itemId, "reject"] as const),
    ]);

    return {
      categoryName: categoryItems[0]!.categoryName,
      accepted: acceptedIds.length,
      rejected: rejectedIds.length,
      pending: countPendingAfter(items, changed),
      pendingInCategory: countPendingAfter(items, changed, categoryKey),
    };
  });
}
