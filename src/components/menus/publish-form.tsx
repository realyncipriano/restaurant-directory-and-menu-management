"use client";

import { useActionState } from "react";

import { publishMenuAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
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
      className="space-y-3"
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="menuId" value={menuId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button
        type="submit"
        variant="success"
        isLoading={pending}
        loadingLabel="Publishing..."
      >
        Publish menu
      </Button>
    </form>
  );
}
