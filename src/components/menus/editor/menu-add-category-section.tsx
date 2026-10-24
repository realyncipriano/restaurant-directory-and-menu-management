import { Plus } from "lucide-react";

import { CategoryForm } from "@/components/menus/category-form";

export function MenuAddCategorySection({
  restaurantId,
  menuId,
  defaultSortOrder,
}: {
  restaurantId: string;
  menuId: string;
  defaultSortOrder: number;
}) {
  return (
    <details className="group rounded-2xl border border-dashed border-zinc-300 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </span>
        Add category
      </summary>
      <div className="border-t border-zinc-100 px-5 py-5">
        <CategoryForm
          mode="create"
          restaurantId={restaurantId}
          menuId={menuId}
          defaultSortOrder={defaultSortOrder}
        />
      </div>
    </details>
  );
}
