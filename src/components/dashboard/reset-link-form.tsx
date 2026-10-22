"use client";

import { useActionState } from "react";

import { createResetLinkAction } from "@/app/dashboard/users/actions";
import { CopyButton } from "@/components/copy-button";
import { buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EMPTY_INVITE_STATE } from "@/lib/action-state";

export function ResetLinkForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    createResetLinkAction,
    EMPTY_INVITE_STATE,
  );

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {pending ? <Spinner className="h-3 w-3" /> : null}
          {pending ? "Creating..." : "Password reset link"}
        </button>
      </form>
      {state.error ? (
        <p className="max-w-xs text-xs text-red-600">{state.error}</p>
      ) : null}
      {state.inviteUrl ? (
        <div className="space-y-2">
          <code className="block max-w-xs overflow-x-auto rounded-lg bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-700">
            {state.inviteUrl}
          </code>
          <CopyButton value={state.inviteUrl} label="Copy reset link" />
        </div>
      ) : null}
    </div>
  );
}
