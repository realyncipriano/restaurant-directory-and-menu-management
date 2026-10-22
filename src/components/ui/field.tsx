import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  required?: boolean;
};

export function Field({
  id,
  label,
  note,
  error,
  optional = false,
  required = false,
  noteLayout = "side",
  children,
  className,
  noteClassName,
}: {
  id: string;
  label: ReactNode;
  note?: ReactNode;
  error?: string;
  optional?: boolean;
  required?: boolean;
  noteLayout?: "side" | "below";
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  className?: string;
  noteClassName?: string;
}) {
  const noteId = note ? `${id}-note` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [noteId, errorId].filter(Boolean).join(" ") || undefined;
  const control: FieldControlProps = {
    id,
    "aria-describedby": describedBy,
    required: required || undefined,
  };
  const sideNote = note && noteLayout === "side";

  return (
    <div
      className={cn(
        "grid gap-2",
        sideNote
          ? "lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-5"
          : undefined,
        className,
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block text-sm font-medium text-zinc-800"
        >
          {label}
          {optional ? (
            <span className="ml-1 font-normal text-zinc-400">(optional)</span>
          ) : null}
        </label>
        <div className="mt-1.5">
          {typeof children === "function" ? children(control) : children}
        </div>
        {error ? (
          <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600">
            {error}
          </p>
        ) : null}
      </div>
      {note ? (
        <p
          id={noteId}
          className={cn(
            "text-xs leading-5 text-zinc-500",
            noteLayout === "side"
              ? "lg:mt-7 lg:rounded-lg lg:border lg:border-zinc-200 lg:bg-zinc-50/80 lg:px-3 lg:py-2"
              : "mt-0",
            noteClassName,
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function FieldError({ message }: { message?: string[] }) {
  if (!message?.length) return null;
  return <p className="mt-1.5 text-xs font-medium text-red-600">{message[0]}</p>;
}
