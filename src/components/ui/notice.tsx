import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type NoticeTone = "success" | "error" | "warning" | "info";

const toneConfig: Record<
  NoticeTone,
  { className: string; icon: typeof Info }
> = {
  success: {
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2,
  },
  error: {
    className: "border-red-200 bg-red-50 text-red-700",
    icon: XCircle,
  },
  warning: {
    className: "border-amber-200 bg-amber-50 text-amber-900",
    icon: AlertTriangle,
  },
  info: {
    className: "border-sky-200 bg-sky-50 text-sky-900",
    icon: Info,
  },
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
  icon,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const config = toneConfig[tone];
  const Icon = config.icon;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm leading-6",
        config.className,
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">
        {icon ?? <Icon className="h-4 w-4" aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}
