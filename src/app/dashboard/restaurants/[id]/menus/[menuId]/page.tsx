import type { Metadata } from "next";
import {
  ChevronDown,
  FilePenLine,
  History,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import {
  discardDraftAction,
  removeItemImageAction,
  startDraftAction,
  uploadItemImageAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { ImageUploadForm } from "@/components/images/image-upload-form";
import { CategoryForm } from "@/components/menus/category-form";
import { ItemForm } from "@/components/menus/item-form";
import { MenuForm } from "@/components/menus/menu-form";
import { PublishMenuForm } from "@/components/menus/publish-form";
import { requireCurrentUser } from "@/lib/auth/guards";
import { NotFoundError } from "@/lib/errors";
import { formatMinorForInput, formatPrice } from "@/lib/money";
import {
  getPublicImageUrl,
  isImageStorageConfigured,
} from "@/server/services/images";
import { getMenuManagement } from "@/server/services/menus";
import type { MenuTree } from "@/server/services/menu-tree";

export const metadata: Metadata = {
  title: "Menu editor",
  robots: { index: false, follow: false },
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusStyles: Record<string, string> = {
  draft: "bg-amber-50 text-amber-800 ring-amber-600/20",
  published: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  archived: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
};

function MenuTreeView({ tree }: { tree: MenuTree }) {
  if (tree.categories.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
        No categories yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {tree.categories.map((category) => (
        <section key={category.id}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900">
              {category.name}
            </h3>
            <span className="text-xs text-zinc-400">
              {category.items.length} item{category.items.length === 1 ? "" : "s"}
            </span>
          </div>
          {category.description ? (
            <p className="mt-0.5 text-xs text-zinc-500">
              {category.description}
            </p>
          ) : null}

          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {category.items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900">
                      {item.name}
                      {item.availabilityStatus === "unavailable" ? (
                        <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                          unavailable
                        </span>
                      ) : null}
                    </p>
                    {item.description ? (
                      <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                        {item.description}
                      </p>
                    ) : null}
                    {item.variants.length > 0 ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.variants
                          .map(
                            (variant) =>
                              `${variant.name} ${formatPrice(variant.priceMinor, item.currency)}`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                    {item.modifiers.length > 0 ? (
                      <p className="mt-0.5 text-xs text-zinc-400">
                        Add-ons:{" "}
                        {item.modifiers
                          .map(
                            (modifier) =>
                              `${modifier.name} +${formatPrice(modifier.additionalPriceMinor, item.currency)}`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-medium text-zinc-900">
                    {formatPrice(item.basePriceMinor, item.currency)}
                  </p>
                </div>
              </li>
            ))}
            {category.items.length === 0 ? (
              <li className="px-4 py-3 text-xs text-zinc-500">
                No items in this category.
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

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
  const { menuId } = await params;
  const query = await searchParams;

  let data;
  try {
    data = await getMenuManagement(getDb(), user.id, menuId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { menu, access, tree, versions, changes } = data;
  const { restaurant, flags } = access;
  const notice = typeof query.notice === "string" ? query.notice : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const isDraft = menu.status === "draft";
  const restaurantActive = restaurant.status === "active";
  const canEdit = flags.canEditMenu && restaurantActive;
  const canPublish = flags.canPublishMenu && restaurantActive && isDraft;
  const imageStorageConfigured = isImageStorageConfigured();

  const noticeMessage =
    notice === "settings"
      ? "Menu details saved."
      : notice === "draft"
        ? "Draft revision created. The published menu is unchanged until you publish."
        : notice === "published"
          ? "Menu published. The previous version was archived."
          : notice === "category-deleted"
            ? "Category deleted from this draft."
            : notice === "item-deleted"
              ? "Menu item deleted from this draft."
              : notice === "import-applied"
                ? "Accepted scan items were applied to this draft. Review the menu before publishing."
                : null;

  const errorMessage =
    error === "draft"
      ? "A draft revision could not be created. Check that this menu still has a published version."
      : error === "discard"
        ? "The draft could not be discarded."
        : error === "delete-category"
          ? "The category could not be deleted."
          : error === "delete-item"
            ? "The menu item could not be deleted."
            : error
              ? "The action could not be completed. Please try again."
              : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/restaurants/${restaurant.id}/menus`}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          ← Menus
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {menu.title}
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${
              statusStyles[menu.status] ?? statusStyles.archived
            }`}
          >
            {menu.status}
          </span>
          <span className="text-xs text-zinc-500">Version {menu.version}</span>
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-500">/{menu.slug}</p>
      </div>

      {noticeMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {noticeMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {!restaurantActive ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {restaurant.name} is archived. Reactivate it from the restaurant page
          before editing or publishing menus.
        </p>
      ) : null}

      {!isDraft ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
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
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  <FilePenLine className="h-4 w-4" aria-hidden="true" />
                  Create draft revision
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-6">
            <MenuTreeView tree={tree} />
          </div>
        </div>
      ) : (
        <>
          {canEdit ? (
            <details className="rounded-2xl border border-zinc-200 bg-white p-5">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-900">
                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                Menu settings
              </summary>
              <div className="mt-5 border-t border-zinc-100 pt-5">
                <MenuForm
                  mode="edit"
                  restaurantId={restaurant.id}
                  menuId={menu.id}
                  values={{
                    title: menu.title,
                    slug: menu.slug,
                    description: menu.description,
                  }}
                />
              </div>
            </details>
          ) : null}

          <div className="space-y-4">
            {tree.categories.map((category) => (
              <section
                key={category.id}
                className="rounded-2xl border border-zinc-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-900">
                      {category.name}
                    </h2>
                    <p className="text-xs text-zinc-500">
                      Sort {category.sortOrder} · {category.items.length} item
                      {category.items.length === 1 ? "" : "s"}
                    </p>
                    {category.description ? (
                      <p className="mt-1 text-sm text-zinc-600">
                        {category.description}
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <details className="w-full sm:w-auto">
                      <summary className="cursor-pointer text-xs font-medium text-zinc-600 hover:text-zinc-900">
                        Edit category
                      </summary>
                      <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                        <CategoryForm
                          mode="edit"
                          restaurantId={restaurant.id}
                          menuId={menu.id}
                          category={{
                            id: category.id,
                            name: category.name,
                            description: category.description,
                            sortOrder: category.sortOrder,
                          }}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {category.items.map((item) => (
                    <details
                      key={item.id}
                      className="rounded-xl border border-zinc-200"
                    >
                      <summary className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900">
                            {item.name}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {formatPrice(item.basePriceMinor, item.currency)}
                            {item.variants.length > 0
                              ? ` · ${item.variants.length} variant${item.variants.length === 1 ? "" : "s"}`
                              : ""}
                            {item.modifiers.length > 0
                              ? ` · ${item.modifiers.length} add-on${item.modifiers.length === 1 ? "" : "s"}`
                              : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {canEdit ? "Edit" : "View"}
                        </span>
                      </summary>
                      <div className="border-t border-zinc-100 px-4 py-4">
                        {canEdit ? (
                          <ItemForm
                            mode="edit"
                            restaurantId={restaurant.id}
                            menuId={menu.id}
                            categories={tree.categories.map((entry) => ({
                              id: entry.id,
                              name: entry.name,
                            }))}
                            values={{
                              id: item.id,
                              categoryId: item.categoryId,
                              name: item.name,
                              description: item.description ?? "",
                              basePrice: formatMinorForInput(
                                item.basePriceMinor,
                              ),
                              availabilityStatus: item.availabilityStatus,
                              sortOrder: item.sortOrder,
                              variants: item.variants.map((variant) => ({
                                name: variant.name,
                                price: formatMinorForInput(variant.priceMinor),
                              })),
                              modifiers: item.modifiers.map((modifier) => ({
                                name: modifier.name,
                                price: formatMinorForInput(
                                  modifier.additionalPriceMinor,
                                ),
                                isAvailable: modifier.isAvailable,
                              })),
                            }}
                          />
                        ) : (
                          <div className="space-y-2 text-sm text-zinc-600">
                            {item.description ? <p>{item.description}</p> : null}
                            {item.variants.map((variant) => (
                              <p key={variant.id} className="text-xs">
                                {variant.name}:{" "}
                                {formatPrice(variant.priceMinor, item.currency)}
                              </p>
                            ))}
                            {item.modifiers.map((modifier) => (
                              <p key={modifier.id} className="text-xs">
                                + {modifier.name}:{" "}
                                {formatPrice(
                                  modifier.additionalPriceMinor,
                                  item.currency,
                                )}
                              </p>
                            ))}
                          </div>
                        )}

                        {canEdit ? (
                          <div className="mt-5 border-t border-zinc-100 pt-5">
                            <ImageUploadForm
                              action={uploadItemImageAction}
                              removeAction={removeItemImageAction}
                              hidden={{
                                restaurantId: restaurant.id,
                                menuId: menu.id,
                                itemId: item.id,
                              }}
                              currentUrl={getPublicImageUrl(
                                item.imageObjectKey,
                              )}
                              label="Item photo"
                              description="Optional photo shown on the public menu."
                              configured={imageStorageConfigured}
                              removeLabel="Remove photo"
                            />
                          </div>
                        ) : getPublicImageUrl(item.imageObjectKey) ? (
                          <div className="mt-4 border-t border-zinc-100 pt-4">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getPublicImageUrl(item.imageObjectKey) ?? ""}
                              alt={item.name}
                              className="h-32 w-32 rounded-xl object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))}

                  {canEdit ? (
                    <details className="rounded-xl border border-dashed border-zinc-300">
                      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-medium text-amber-700">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Add item to {category.name}
                      </summary>
                      <div className="border-t border-zinc-100 px-4 py-4">
                        <ItemForm
                          mode="create"
                          restaurantId={restaurant.id}
                          menuId={menu.id}
                          categories={tree.categories.map((entry) => ({
                            id: entry.id,
                            name: entry.name,
                          }))}
                          defaultCategoryId={category.id}
                          defaultSortOrder={(category.items.length + 1) * 10}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          {canEdit ? (
            <details className="rounded-2xl border border-dashed border-zinc-300 bg-white p-5">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-900">
                <Plus className="h-4 w-4 text-amber-700" aria-hidden="true" />
                Add category
              </summary>
              <div className="mt-5 border-t border-zinc-100 pt-5">
                <CategoryForm
                  mode="create"
                  restaurantId={restaurant.id}
                  menuId={menu.id}
                  defaultSortOrder={(tree.categories.length + 1) * 10}
                />
              </div>
            </details>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {canPublish ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Publish this draft
                </h2>
                <p className="mt-2 text-sm leading-6 text-emerald-900/80">
                  Publishing validates prices, archives the current published
                  version, and makes this draft live.
                </p>
                <div className="mt-4">
                  <PublishMenuForm
                    restaurantId={restaurant.id}
                    menuId={menu.id}
                  />
                </div>
              </section>
            ) : null}

            {canEdit ? (
              <section className="rounded-2xl border border-red-200 bg-red-50/40 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-red-900">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Discard draft
                </h2>
                <p className="mt-2 text-sm leading-6 text-red-900/80">
                  Removes this draft without changing the published menu. The
                  draft stays in version history as archived.
                </p>
                <form action={discardDraftAction} className="mt-4">
                  <input type="hidden" name="restaurantId" value={restaurant.id} />
                  <input type="hidden" name="menuId" value={menu.id} />
                  <ConfirmButton
                    message="Discard this draft? The published menu will stay live."
                    className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Discard draft
                  </ConfirmButton>
                </form>
              </section>
            ) : null}
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <History className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Version history
          </h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/dashboard/restaurants/${restaurant.id}/menus/${version.id}`}
                  className={
                    version.id === menu.id
                      ? "font-semibold text-zinc-900"
                      : "text-zinc-600 hover:text-amber-800"
                  }
                >
                  Version {version.version}
                  {version.status === "published"
                    ? " · published"
                    : version.status === "draft"
                      ? " · draft"
                      : " · archived"}
                </Link>
                <span className="text-xs text-zinc-400">
                  {dateFormatter.format(version.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-900">
            Recorded changes
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Changes are recorded when this version is published.
          </p>
          {changes.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No recorded changes.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {changes.slice(0, 12).map((change) => (
                <li key={change.id} className="text-xs text-zinc-600">
                  <span className="font-medium capitalize text-zinc-800">
                    {change.action.replaceAll("_", " ")}
                  </span>
                  {" · "}
                  {dateFormatter.format(change.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
