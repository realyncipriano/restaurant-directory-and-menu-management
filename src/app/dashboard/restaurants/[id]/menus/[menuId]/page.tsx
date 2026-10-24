import type { Metadata } from "next";
import { FilePenLine } from "lucide-react";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import { startDraftAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { MenuAddCategorySection } from "@/components/menus/editor/menu-add-category-section";
import { MenuCategoryNav } from "@/components/menus/editor/menu-category-nav";
import { MenuCategorySection } from "@/components/menus/editor/menu-category-section";
import { MenuEditorHeader } from "@/components/menus/editor/menu-editor-header";
import { MenuEditorNotices } from "@/components/menus/editor/menu-editor-notices";
import { MenuHistoryCards } from "@/components/menus/editor/menu-history-cards";
import { MenuLifecycleActions } from "@/components/menus/editor/menu-lifecycle-actions";
import { MenuSettingsSection } from "@/components/menus/editor/menu-settings-section";
import { MenuTreeView } from "@/components/menus/editor/menu-tree-view";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import {
  buildCategoryOptions,
  buildMenuEditorMessages,
  deriveMenuEditorFlags,
  menuStatusTone,
  nextCategorySortOrder,
} from "@/lib/menu-editor-view";
import { isImageStorageConfigured } from "@/server/services/images";
import { getMenuManagement } from "@/server/services/menus";

export const metadata: Metadata = {
  title: "Menu editor",
  robots: { index: false, follow: false },
};

export default async function MenuEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; menuId: string }>;
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { id, menuId } = await params;
  const query = await searchParams;

  let data;
  try {
    data = await getMenuManagement(getDb(), user.id, menuId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { menu, access, tree, versions, changes } = data;
  if (menu.restaurantId !== id) notFound();

  const { restaurant, flags } = access;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const { isDraft, restaurantActive, canEdit, canPublish } =
    deriveMenuEditorFlags({
      canEditMenu: flags.canEditMenu,
      canPublishMenu: flags.canPublishMenu,
      restaurantStatus: restaurant.status,
      menuStatus: menu.status,
    });
  const imageStorageConfigured = isImageStorageConfigured();
  const categoryOptions = buildCategoryOptions(tree.categories);
  const statusTone = menuStatusTone(menu.status);
  const { noticeMessage, errorMessage } = buildMenuEditorMessages({
    notice,
    error,
  });

  return (
    <div className="space-y-6">
      <MenuEditorHeader
        restaurantId={restaurant.id}
        title={menu.title}
        slug={menu.slug}
        version={menu.version}
        status={menu.status}
        statusTone={statusTone}
      />

      <MenuEditorNotices
        noticeMessage={noticeMessage}
        errorMessage={errorMessage}
        restaurantActive={restaurantActive}
        restaurantName={restaurant.name}
      />

      <MenuCategoryNav
        categories={tree.categories.map((category) => ({
          id: category.id,
          name: category.name,
          itemCount: category.items.length,
        }))}
      />

      {!isDraft ? (
        <Card>
          <CardBody>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">
                  {menu.status === "published"
                    ? "Published menu"
                    : "Archived version"}
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-600">
                  {menu.status === "published"
                    ? "This version is live and cannot be edited in place. Create a draft revision to change prices or items without unpublishing."
                    : "This version has been archived. Editing it creates a new draft from the latest published version."}
                </p>
              </div>
              {canEdit ? (
                <form action={startDraftAction}>
                  <input type="hidden" name="restaurantId" value={restaurant.id} />
                  <input type="hidden" name="menuId" value={menu.id} />
                  <button
                    type="submit"
                    className={buttonClass({ variant: "secondary" })}
                  >
                    <FilePenLine className="h-4 w-4" aria-hidden="true" />
                    Create draft revision
                  </button>
                </form>
              ) : null}
            </div>

            <div className="mt-6">
              <MenuTreeView categories={tree.categories} />
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          {canEdit ? (
            <MenuSettingsSection
              restaurantId={restaurant.id}
              menuId={menu.id}
              title={menu.title}
              slug={menu.slug}
              description={menu.description}
            />
          ) : null}

          <div className="space-y-4">
            {tree.categories.map((category, index) => (
              <MenuCategorySection
                key={category.id}
                restaurantId={restaurant.id}
                menuId={menu.id}
                category={category}
                categories={categoryOptions}
                canEdit={canEdit}
                imageStorageConfigured={imageStorageConfigured}
                open={index === 0}
              />
            ))}
          </div>

          {canEdit ? (
            <MenuAddCategorySection
              restaurantId={restaurant.id}
              menuId={menu.id}
              defaultSortOrder={nextCategorySortOrder(tree.categories.length)}
            />
          ) : null}

          <MenuLifecycleActions
            restaurantId={restaurant.id}
            menuId={menu.id}
            canEdit={canEdit}
            canPublish={canPublish}
          />
        </>
      )}

      <MenuHistoryCards
        restaurantId={restaurant.id}
        currentMenuId={menu.id}
        versions={versions}
        changes={changes}
      />
    </div>
  );
}
