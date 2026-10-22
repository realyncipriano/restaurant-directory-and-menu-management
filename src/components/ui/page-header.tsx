import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function PageHeader({
  backHref,
  backLabel,
  eyebrow,
  icon,
  title,
  description,
  actions,
  className,
}: {
  backHref?: string;
  backLabel?: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-zinc-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {backLabel ?? "Back"}
          </Link>
        ) : null}
        {eyebrow ? (
          <p className={cn("text-sm font-medium text-amber-700", backHref && "mt-3")}>
            {eyebrow}
          </p>
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-center gap-3",
            (eyebrow || backHref) && "mt-1",
          )}
        >
          {icon ? (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/10">
              {icon}
            </span>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
