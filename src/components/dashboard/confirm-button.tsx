"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/ui/spinner";

export function ConfirmButton({
  children,
  message,
  className,
}: {
  children: ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      aria-busy={pending}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? (
        <Spinner className="mr-1 inline h-3 w-3 align-[-2px]" />
      ) : null}
      {children}
    </button>
  );
}
