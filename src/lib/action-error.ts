import type { FormState } from "@/lib/action-state";
import { ValidationError, safeErrorMessage } from "@/lib/errors";

export function formStateFromError(error: unknown): FormState {
  return {
    error: safeErrorMessage(error),
    fieldErrors:
      error instanceof ValidationError ? error.fieldErrors : undefined,
  };
}
