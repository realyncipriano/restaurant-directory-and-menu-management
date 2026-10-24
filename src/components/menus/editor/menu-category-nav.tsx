export type MenuCategoryNavItem = {
  id: string;
  name: string;
  itemCount: number;
};

export function MenuCategoryNav({
  categories,
}: {
  categories: readonly MenuCategoryNavItem[];
}) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Jump to menu category"
      className="rounded-xl border border-zinc-200 bg-white/90 p-2 shadow-sm lg:sticky lg:top-[4.5rem] lg:z-20 lg:backdrop-blur"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        <span className="shrink-0 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          Jump to
        </span>
        {categories.map((category) => (
          <a
            key={category.id}
            href={`#category-${category.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {category.name}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {category.itemCount}
            </span>
          </a>
        ))}
      </div>
    </nav>
  );
}
