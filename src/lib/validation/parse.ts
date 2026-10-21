import { z } from "zod";

import { ValidationError } from "@/lib/errors";

export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Please check the submitted values.",
      fieldErrors,
    );
  }
  return result.data;
}
