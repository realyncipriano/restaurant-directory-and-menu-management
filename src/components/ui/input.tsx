import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const inputClass =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, className)} />;
}

export function FileInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        inputClass,
        "cursor-pointer text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200",
        className,
      )}
    />
  );
}
