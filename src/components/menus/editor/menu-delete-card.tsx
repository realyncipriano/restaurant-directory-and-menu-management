import { Trash2 } from "lucide-react";

import { deleteMenuAction } from "@/app/dashboard/restaurants/[id]/menus/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export function MenuDeleteCard({
  restaurantId,
  menuId,
  menuTitle,
  hasPublishedVersion,
}: {
  restaurantId: string;
  menuId: string;
  menuTitle: string;
  hasPublishedVersion: boolean;
}) {
  return (
    <Card className="border-red-300 bg-red-50/60">
      <CardBody>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-900">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete menu
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-red-900/80">
          {hasPublishedVersion
            ? `Deletes the live menu “${menuTitle}” and every version in its history. Guests will no longer see it. The data stays archived and cannot be restored from the app.`
            : `Deletes “${menuTitle}” and every version in its history. It will be removed from the menus list. The data stays archived and cannot be restored from the app.`}
        </p>
        <form action={deleteMenuAction} className="mt-4">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="menuId" value={menuId} />
          <ConfirmButton
            message={
              hasPublishedVersion
                ? `Delete “${menuTitle}” and all of its versions? The live menu will disappear from public pages.`
                : `Delete “${menuTitle}” and all of its versions?`
            }
            className={buttonClass({ variant: "danger", size: "sm" })}
          >
            Delete menu
          </ConfirmButton>
        </form>
      </CardBody>
    </Card>
  );
}
