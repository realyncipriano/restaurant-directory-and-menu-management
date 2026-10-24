import { Send, Trash2 } from "lucide-react";

import { discardDraftAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { PublishMenuForm } from "@/components/menus/publish-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export function MenuLifecycleActions({
  restaurantId,
  menuId,
  canEdit,
  canPublish,
}: {
  restaurantId: string;
  menuId: string;
  canEdit: boolean;
  canPublish: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canPublish ? (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardBody>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Send className="h-4 w-4" aria-hidden="true" />
              Publish this draft
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900/80">
              Publishing validates prices, archives the current published
              version, and makes this draft live.
            </p>
            <div className="mt-4">
              <PublishMenuForm
                restaurantId={restaurantId}
                menuId={menuId}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {canEdit ? (
        <Card className="border-red-200 bg-red-50/40">
          <CardBody>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-red-900">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Discard draft
            </h2>
            <p className="mt-2 text-sm leading-6 text-red-900/80">
              Removes this draft without changing the published menu. The
              draft stays in version history as archived.
            </p>
            <form action={discardDraftAction} className="mt-4">
              <input type="hidden" name="restaurantId" value={restaurantId} />
              <input type="hidden" name="menuId" value={menuId} />
              <ConfirmButton
                message="Discard this draft? The published menu will stay live."
                className={buttonClass({ variant: "danger", size: "sm" })}
              >
                Discard draft
              </ConfirmButton>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
