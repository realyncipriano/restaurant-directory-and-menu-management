"use client";

import { CheckCheck } from "lucide-react";
import { useFormStatus } from "react-dom";

import { acceptAllImportItemsAction } from "@/app/dashboard/restaurants/[id]/imports/actions";
import { buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function AcceptAllButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={buttonClass({
        variant: "outline",
        size: "sm",
        className:
          "w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
      })}
    >
      {pending ? (
        <Spinner className="h-3.5 w-3.5" />
      ) : (
        <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {pending
        ? "Accepting confident items..."
        : "Accept all confident, priced items"}
    </button>
  );
}

export function AcceptAllForm({
  restaurantId,
  importId,
  pendingCount,
}: {
  restaurantId: string;
  importId: string;
  pendingCount: number;
}) {
  return (
    <form action={acceptAllImportItemsAction} className="space-y-2">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="importId" value={importId} />
      <AcceptAllButton disabled={pendingCount === 0} />
      <p className="text-[11px] leading-4 text-zinc-500">
        Duplicates and unpriced items stay pending.
      </p>
    </form>
  );
}
