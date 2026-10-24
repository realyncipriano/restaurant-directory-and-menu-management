import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { ImportCategorySection } from "@/components/imports/review/import-category-section";
import { ImportItemList } from "@/components/imports/review/import-item-list";
import { ImportPagesCard } from "@/components/imports/review/import-pages-card";
import { ImportReviewHeader } from "@/components/imports/review/import-review-header";
import { ImportReviewNotices } from "@/components/imports/review/import-review-notices";
import { ImportReviewSidebar } from "@/components/imports/review/import-review-sidebar";
import { requireCurrentUser } from "@/lib/auth/guards";
import {
  getExtractionConfig,
  isExtractionConfigured,
} from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import {
  buildImportReviewNotices,
  buildImportReviewView,
} from "@/lib/import-review-view";
import { getMenuImport } from "@/server/services/imports";

export const metadata: Metadata = {
  title: "Scan review",
  robots: { index: false, follow: false },
};

function queryString(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function queryNumber(
  value: string | string[] | undefined,
): number | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function MenuImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; importId: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
    category?: string | string[];
    accepted?: string | string[];
    rejected?: string | string[];
    pending?: string | string[];
    pendingInCategory?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { id, importId } = await params;
  const query = await searchParams;

  let data;
  try {
    data = await getMenuImport(getDb(), user.id, importId);
    if (data.import.restaurantId !== id) notFound();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { import: record, menu, access, pages, items } = data;
  const { restaurant, flags } = access;
  const canEdit = flags.canEditMenu && restaurant.status === "active";
  const extractionConfigured = isExtractionConfigured();
  const maxPages = getExtractionConfig()?.maxPages ?? 10;
  const selectedCategoryParam = queryString(query.category);
  const view = buildImportReviewView(items, selectedCategoryParam);
  const canProcess =
    canEdit &&
    extractionConfigured &&
    (record.status === "uploaded" || record.status === "failed");
  const failedMessage =
    record.status === "failed" && record.errorDetails?.message
      ? String(record.errorDetails.message)
      : null;
  const notices = buildImportReviewNotices({
    notice: queryString(query.notice),
    error: queryString(query.error),
    accepted: queryNumber(query.accepted),
    rejected: queryNumber(query.rejected),
    pending: queryNumber(query.pending),
    pendingInCategory: queryNumber(query.pendingInCategory),
    selectedCategoryParam,
    activeCategoryName: view.activeCategory?.name,
    selectedCategoryMissing: view.selectedCategoryMissing,
    failedMessage,
    extractionConfigured,
    canEdit,
    status: record.status,
  });

  return (
    <div className="space-y-6">
      <ImportReviewHeader
        restaurantId={restaurant.id}
        menuId={menu.id}
        menuTitle={menu.title}
        menuVersion={menu.version}
        createdAt={record.createdAt}
        status={record.status}
      />

      <ImportReviewNotices notices={notices} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ImportPagesCard
          restaurantId={restaurant.id}
          importId={importId}
          pages={pages}
        />

        <ImportReviewSidebar
          restaurantId={restaurant.id}
          importId={importId}
          menuId={menu.id}
          status={record.status}
          appliedAt={record.appliedAt}
          pagesCount={pages.length}
          maxPages={maxPages}
          stats={view.stats}
          itemsCount={view.counts.total}
          pendingCount={view.counts.pending}
          acceptCount={view.counts.accepted}
          canProcess={canProcess}
          canEdit={canEdit}
          activeCategoryName={view.activeCategory?.name ?? null}
        />
      </div>

      <ImportCategorySection
        restaurantId={restaurant.id}
        importId={importId}
        itemCount={view.counts.total}
        counts={view.counts}
        categories={view.categories}
        activeCategory={view.activeCategory}
        pendingOutsideCategory={view.pendingOutsideCategory}
        keepOnlyMessage={view.keepOnlyMessage}
        canEdit={canEdit}
        status={record.status}
      />

      <ImportItemList
        restaurantId={restaurant.id}
        importId={importId}
        itemCount={view.counts.total}
        visibleCount={view.visibleCount}
        visibleReviewCount={view.visibleReviewCount}
        groups={view.visibleGroups}
        activeCategoryName={view.activeCategory?.name ?? null}
        canEdit={canEdit}
        status={record.status}
      />
    </div>
  );
}
