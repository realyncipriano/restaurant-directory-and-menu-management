import { ChevronDown } from "lucide-react";

import {
  removeItemImageAction,
  uploadItemImageAction,
} from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ImageUploadForm } from "@/components/images/image-upload-form";
import { ItemForm } from "@/components/menus/item-form";
import type {
  MenuEditorCategoryOption,
  MenuEditorItem,
} from "@/lib/menu-editor-view";
import {
  addOnCountLabel,
  toItemFormValues,
  variantCountLabel,
} from "@/lib/menu-editor-view";
import { formatPrice } from "@/lib/money";
import { getPublicImageUrl } from "@/server/services/images";

export type MenuItemCardVariant = MenuEditorItem["variants"][number] & {
  id: string;
};

export type MenuItemCardModifier = MenuEditorItem["modifiers"][number] & {
  id: string;
};

export type MenuItemCardItem = Omit<MenuEditorItem, "variants" | "modifiers"> & {
  imageObjectKey: string | null;
  variants: readonly MenuItemCardVariant[];
  modifiers: readonly MenuItemCardModifier[];
};

export function MenuItemCard({
  restaurantId,
  menuId,
  item,
  categories,
  canEdit,
  imageStorageConfigured,
}: {
  restaurantId: string;
  menuId: string;
  item: MenuItemCardItem;
  categories: MenuEditorCategoryOption[];
  canEdit: boolean;
  imageStorageConfigured: boolean;
}) {
  return (
    <details className="group rounded-xl border border-zinc-200 bg-zinc-50/40 transition open:bg-white">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900">{item.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {formatPrice(item.basePriceMinor, item.currency)}
            {item.variants.length > 0
              ? ` · ${variantCountLabel(item.variants.length)}`
              : ""}
            {item.modifiers.length > 0
              ? ` · ${addOnCountLabel(item.modifiers.length)}`
              : ""}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
          {canEdit ? "Edit" : "View"}
          <ChevronDown
            className="h-3.5 w-3.5 transition group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="border-t border-zinc-100 px-4 py-4">
        {canEdit ? (
          <ItemForm
            mode="edit"
            restaurantId={restaurantId}
            menuId={menuId}
            categories={categories}
            values={toItemFormValues(item)}
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
                {formatPrice(modifier.additionalPriceMinor, item.currency)}
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
                restaurantId,
                menuId,
                itemId: item.id,
              }}
              currentUrl={getPublicImageUrl(item.imageObjectKey)}
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
  );
}
