"use client";

import { Send } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { publishMenuAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  const [open, setOpen] = useState(false);
  const formId = useId().replaceAll(":", "");

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <form id={formId} action={formAction} className="space-y-3">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="menuId" value={menuId} />
      {state.error && !open ? (
        <Notice tone="error">{state.error}</Notice>
      ) : null}
      <Button
        type="button"
        variant="success"
        onClick={() => setOpen(true)}
      >
        Publish menu
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Publish this menu?"
        description="The currently published version will be archived and replaced. Guests will see this draft immediately."
        tone="success"
        icon={<Send className="h-5 w-5" aria-hidden="true" />}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="success"
              isLoading={pending}
              loadingLabel="Publishing..."
            >
              Publish menu
            </Button>
          </>
        }
      >
        {state.error ? (
          <Notice tone="error">{state.error}</Notice>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3 text-xs leading-5 text-emerald-900">
            Check that prices and availability are current before publishing.
            You can create another draft afterward without unpublishing.
          </div>
        )}
      </Modal>
    </form>
  );
}
