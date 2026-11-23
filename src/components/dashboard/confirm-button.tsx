"use client";

import { AlertTriangle } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonVariant } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";

export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel,
  pendingLabel = "Working...",
  tone = "danger",
  confirmVariant = "danger",
  className,
}: {
  children: ReactNode;
  title?: string;
  message: string;
  confirmLabel?: string;
  pendingLabel?: string;
  tone?: "default" | "danger";
  confirmVariant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    if (!pending) setOpen(false);
  }

  function confirm() {
    triggerRef.current?.form?.requestSubmit();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="submit"
        disabled={pending}
        className={className}
        aria-busy={pending}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {pending ? (
          <Spinner className="mr-1 inline h-3 w-3 align-[-2px]" />
        ) : null}
        {children}
      </button>

      <Modal
        open={open}
        onClose={close}
        title={title ?? "Confirm action"}
        description={message}
        tone={tone}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
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
              type="button"
              variant={confirmVariant}
              onClick={confirm}
              isLoading={pending}
              loadingLabel={pendingLabel}
            >
              {confirmLabel ??
                (typeof children === "string" ? children : "Confirm")}
            </Button>
          </>
        }
      />
    </>
  );
}
