import { ChevronDown, Plus } from "lucide-react";

import { CategoryForm } from "@/components/menus/category-form";
import {
  MenuItemCard,
  type MenuItemCardItem,
} from "@/components/menus/editor/menu-item-card";
import { ItemForm } from "@/components/menus/item-form";
import type { MenuEditorCategoryOption } from "@/lib/menu-editor-view";
import { itemCountLabel, nextItemSortOrder } from "@/lib/menu-editor-view";

export type MenuCategorySectionCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  items: readonly MenuItemCardItem[];
};

export function MenuCategorySection({
  restaurantId,
  menuId,
  category,
  categories,
  canEdit,
  imageStorageConfigured,
  open,
}: {
  restaurantId: string;
  menuId: string;
  category: MenuCategorySectionCategory;
  categories: MenuEditorCategoryOption[];
  canEdit: boolean;
  imageStorageConfigured: boolean;
  open: boolean;
}) {
  return (
    <details
      id={`category-${category.id}`}
      open={open}
      className="group scroll-mt-6 overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(42,34,25,0.04)] lg:scroll-mt-28"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">
            {category.name}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Sort {category.sortOrder} · {itemCountLabel(category.items.length)}
            {category.description ? ` · ${category.description}` : ""}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500">
          Items
          <ChevronDown
            className="h-3.5 w-3.5 transition group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>

      <div className="border-t border-zinc-100 px-5 py-4">
        {canEdit ? (
          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 hover:text-zinc-900">
              Edit category
            </summary>
            <div className="mt-3 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:w-96">
              <CategoryForm
                mode="edit"
                restaurantId={restaurantId}
                menuId={menuId}
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

        <div className="space-y-2">
          {category.items.map((item) => (
            <MenuItemCard
              key={item.id}
              restaurantId={restaurantId}
              menuId={menuId}
              item={item}
              categories={categories}
              canEdit={canEdit}
              imageStorageConfigured={imageStorageConfigured}
            />
          ))}

          {canEdit ? (
            <details className="rounded-xl border border-dashed border-zinc-300 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-medium text-amber-700 [&::-webkit-details-marker]:hidden">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add item to {category.name}
              </summary>
              <div className="border-t border-zinc-100 px-4 py-4">
                <ItemForm
                  mode="create"
                  restaurantId={restaurantId}
                  menuId={menuId}
                  categories={categories}
                  defaultCategoryId={category.id}
                  defaultSortOrder={nextItemSortOrder(category.items.length)}
                />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </details>
  );
}
