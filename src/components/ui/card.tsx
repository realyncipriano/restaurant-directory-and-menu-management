import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        className,
      )}
    />
  );
}

export function CardHeader({
  title,
  description,
  icon,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4 sm:px-6",
        className,
      )}
    >
      <div className="min-w-0">
        {title ? (
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            {icon}
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
        ) : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("p-5 sm:p-6", className)} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-zinc-100 px-5 py-4 sm:px-6",
        className,
      )}
    />
  );
}

export function CardSectionTitle({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          {icon}
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
