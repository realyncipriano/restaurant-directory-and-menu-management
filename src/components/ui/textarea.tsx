import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "block w-full rounded-lg border border-zinc-300 bg-surface px-3 py-2.5 text-sm leading-6 text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500",
        className,
      )}
    />
  );
}
