import { describe, expect, it } from "vitest";

import { formStateFromError } from "@/lib/action-error";
import { ConflictError, ValidationError } from "@/lib/errors";

describe("formStateFromError", () => {
  it("preserves validation messages and field errors", () => {
    const error = new ValidationError("Check the form.", {
      name: ["Enter an item name."],
    });

    expect(formStateFromError(error)).toEqual({
      error: "Check the form.",
      fieldErrors: {
        name: ["Enter an item name."],
      },
    });
  });

  it("preserves app error messages without field errors", () => {
    const state = formStateFromError(
      new ConflictError("That change conflicts."),
    );

    expect(state.error).toBe("That change conflicts.");
    expect(state.fieldErrors).toBeUndefined();
  });

  it("uses the standard fallback for unknown errors", () => {
    expect(formStateFromError(new Error("database details"))).toEqual({
      error: "Something went wrong. Please try again.",
      fieldErrors: undefined,
    });
  });
});
