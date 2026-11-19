"use client";

import { useFormStatus } from "react-dom";

import { setUserRoleAction } from "@/app/dashboard/users/actions";
import {
  buttonClass,
  type ButtonVariant,
} from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function SubmitButton({
  label,
  variant,
  confirmMessage,
}: {
  label: string;
  variant: ButtonVariant;
  confirmMessage: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className={buttonClass({ variant, size: "sm" })}
    >
      {pending ? <Spinner className="h-3 w-3" /> : null}
      {pending ? "Saving..." : label}
    </button>
  );
}

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
  const confirmMessage = makeAdmin
    ? `Grant full administrator access to ${name}?`
    : `Remove administrator access from ${name}?`;

  return (
    <form action={setUserRoleAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={role} />
      <SubmitButton
        label={label}
        variant={makeAdmin ? "outline" : "danger"}
        confirmMessage={confirmMessage}
      />
    </form>
  );
}
