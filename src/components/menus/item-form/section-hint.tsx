import type { ReactNode } from "react";

export function SectionHint({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-semibold text-zinc-800">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
