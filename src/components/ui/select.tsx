import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500",
        className,
      )}
    />
  );
}
