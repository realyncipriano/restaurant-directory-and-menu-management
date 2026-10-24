import { formatPrice } from "@/lib/money";

export type MenuTreeViewVariant = {
  id: string;
  name: string;
  priceMinor: number | null;
};

export type MenuTreeViewModifier = {
  id: string;
  name: string;
  additionalPriceMinor: number | null;
};

export type MenuTreeViewItem = {
  id: string;
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  currency: string;
  availabilityStatus: "available" | "unavailable";
  variants: readonly MenuTreeViewVariant[];
  modifiers: readonly MenuTreeViewModifier[];
};

export type MenuTreeViewCategory = {
  id: string;
  name: string;
  description: string | null;
  items: readonly MenuTreeViewItem[];
};

export function MenuTreeView({
  categories,
}: {
  categories: readonly MenuTreeViewCategory[];
}) {
  if (categories.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
        No categories yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {categories.map((category) => (
        <section
          key={category.id}
          id={`category-${category.id}`}
          className="scroll-mt-6 lg:scroll-mt-28"
        >
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
