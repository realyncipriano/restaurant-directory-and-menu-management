"use client";

import { useActionState } from "react";

import { publishMenuAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { EMPTY_FORM_STATE } from "@/lib/action-state";

export function PublishMenuForm({
  restaurantId,
  menuId,
}: {
  restaurantId: string;
  menuId: string;
}) {
  const [state, formAction, pending] = useActionState(
    publishMenuAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Publish this draft? The currently published version will be archived and replaced.",
          )
        ) {
          event.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="menuId" value={menuId} />
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Publishing..." : "Publish menu"}
      </button>
    </form>
  );
}
