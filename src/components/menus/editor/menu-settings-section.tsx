import { ChevronDown } from "lucide-react";

import { MenuForm } from "@/components/menus/menu-form";

export function MenuSettingsSection({
  restaurantId,
  menuId,
  title,
  slug,
  description,
}: {
  restaurantId: string;
  menuId: string;
  title: string;
  slug: string;
  description: string | null;
}) {
  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="h-4 w-4 text-zinc-400 transition group-open:rotate-180"
          aria-hidden="true"
        />
        Menu settings
        <span className="ml-auto text-xs font-normal text-zinc-400">
          Title, URL, description
        </span>
      </summary>
      <div className="border-t border-zinc-100 px-5 py-5">
        <MenuForm
          mode="edit"
          restaurantId={restaurantId}
          menuId={menuId}
          values={{
            title,
            slug,
            description,
          }}
        />
      </div>
    </details>
  );
}
