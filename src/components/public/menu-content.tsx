import { formatPrice } from "@/lib/money";
import { getPublicImageUrl } from "@/server/services/images";
import type { MenuTreeCategory } from "@/server/services/menu-tree";

type MenuContentHeadingLevel = 2 | 4;

type MenuContentProps = {
  categories: MenuTreeCategory[];
  headingLevel: MenuContentHeadingLevel;
};

export function MenuContent({
  categories,
  headingLevel,
}: MenuContentProps) {
  const CategoryHeading = headingLevel === 2 ? "h2" : "h4";
  const ItemHeading = headingLevel === 2 ? "h3" : "h5";

  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500">
        This menu does not have any categories yet.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {categories.map((category) => (
        <section
          key={category.id}
          id={`category-${category.id}`}
          className="scroll-mt-20"
        >
          <div className="border-b border-zinc-200 pb-3">
            <CategoryHeading className="font-serif text-2xl font-medium tracking-tight text-zinc-900">
              {category.name}
            </CategoryHeading>
            {category.description ? (
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                {category.description}
              </p>
            ) : null}
          </div>

          <ul className="divide-y divide-zinc-100">
            {category.items.map((item) => {
              const imageUrl = getPublicImageUrl(item.imageObjectKey);

              return (
                <li key={item.id} className="py-5">
                  <div className="flex items-start justify-between gap-6">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={item.name}
                        className="hidden h-24 w-24 shrink-0 rounded-xl object-cover sm:block"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <ItemHeading className="text-base font-medium text-zinc-900">
                        {item.name}
                        {item.availabilityStatus === "unavailable" ? (
                          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            Currently unavailable
                          </span>
                        ) : null}
                      </ItemHeading>
                      {item.description ? (
                        <p className="mt-1 text-sm leading-6 text-zinc-600">
                          {item.description}
                        </p>
                      ) : null}

                      {item.variants.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                          {item.variants.map((variant) => (
                            <li
                              key={variant.id}
                              className="flex justify-between gap-4 sm:max-w-sm"
                            >
                              <span>{variant.name}</span>
                              <span className="font-medium text-zinc-900">
                                {formatPrice(
                                  variant.priceMinor,
                                  item.currency,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {item.modifiers.length > 0 ? (
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          Add-ons:{" "}
                          {item.modifiers
                            .map(
                              (modifier) =>
                                `${modifier.name} +${formatPrice(
                                  modifier.additionalPriceMinor,
                                  item.currency,
                                )}${modifier.isAvailable ? "" : " (unavailable)"}`,
                            )
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>

                    <p className="shrink-0 text-base font-semibold text-zinc-900">
                      {item.basePriceMinor !== null
                        ? formatPrice(item.basePriceMinor, item.currency)
                        : item.variants.length > 0
                          ? "Varies"
                          : "Price not listed"}
                    </p>
                  </div>
                </li>
              );
            })}
            {category.items.length === 0 ? (
              <li className="py-5 text-sm text-zinc-500">
                No items listed in this category.
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
