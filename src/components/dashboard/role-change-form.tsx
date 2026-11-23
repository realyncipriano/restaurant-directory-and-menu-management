"use client";

import { setUserRoleAction } from "@/app/dashboard/users/actions";
import { ConfirmButton } from "@/components/dashboard/confirm-button";
import { buttonClass } from "@/components/ui/button";

export function RoleChangeForm({
  userId,
  name,
  makeAdmin,
}: {
  userId: string;
  name: string;
  makeAdmin: boolean;
}) {
  const role = makeAdmin ? "admin" : "authorized_user";
  const label = makeAdmin ? "Make administrator" : "Remove administrator";

  return (
    <form action={setUserRoleAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={role} />
      <ConfirmButton
        title={
          makeAdmin
            ? `Grant administrator access to ${name}?`
            : `Remove administrator access from ${name}?`
        }
        message={
          makeAdmin
            ? "They will be able to manage all restaurants, users, and settings."
            : "They will lose access to admin tools and settings."
        }
        confirmLabel={label}
        pendingLabel="Saving..."
        tone={makeAdmin ? "default" : "danger"}
        confirmVariant={makeAdmin ? "primary" : "danger"}
        className={buttonClass({
          variant: makeAdmin ? "outline" : "danger",
          size: "sm",
        })}
      >
        {label}
      </ConfirmButton>
    </form>
  );
}
