import { z } from "zod";

import { MAX_PRICE_MINOR, parsePriceToMinor } from "@/lib/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => value || null);

const normalizedOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .nullish()
    .transform((value) => value || null);

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(80, "Slug must be 80 characters or fewer.")
  .refine(
    (value) =>
      value === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    "Use lowercase letters, numbers, and single hyphens.",
  )
  .optional()
  .transform((value) => value || undefined);

export const priceInputSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    const result = parsePriceToMinor(value ?? "");
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.message });
      return z.NEVER;
    }
    return result.minor;
  });

const requiredPriceSchema = priceInputSchema.refine(
  (value): value is number => value !== null,
  "Enter a price.",
);

const sortOrderSchema = z.coerce
  .number()
  .int("Sort order must be a whole number.")
  .min(0, "Sort order cannot be negative.")
  .max(100000, "Sort order is too large.")
  .default(0);

export const menuInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Enter a menu title.")
    .max(120, "Title must be 120 characters or fewer."),
  slug: slugSchema,
  description: optionalText(2000),
});

export const categoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a category name.")
    .max(120, "Category name must be 120 characters or fewer."),
  description: optionalText(1000),
  sortOrder: sortOrderSchema,
});

const variantNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a variant name.")
  .max(120, "Variant name must be 120 characters or fewer.");

const modifierNameSchema = z
  .string()
  .trim()
  .min(1, "Enter an add-on name.")
  .max(120, "Add-on name must be 120 characters or fewer.");

const itemNameSchema = z
  .string()
  .trim()
  .min(1, "Enter an item name.")
  .max(160, "Item name must be 160 characters or fewer.");

const baseMinorPriceSchema = z
  .number()
  .int("Price must be a whole number of cents.")
  .min(0, "Price cannot be negative.")
  .max(MAX_PRICE_MINOR, "That price is too large.")
  .nullable();

const requiredMinorPriceSchema = baseMinorPriceSchema.refine(
  (value): value is number => value !== null,
  "Enter a price.",
);

const variantSchema = z.object({
  name: variantNameSchema,
  price: requiredPriceSchema,
});

const modifierSchema = z.object({
  name: modifierNameSchema,
  price: priceInputSchema.transform((value) => value ?? 0),
  isAvailable: z.boolean().default(true),
});

const normalizedVariantSchema = z.object({
  name: variantNameSchema,
  price: requiredMinorPriceSchema,
});

const normalizedModifierSchema = z.object({
  name: modifierNameSchema,
  price: baseMinorPriceSchema.transform((value) => value ?? 0),
  isAvailable: z.boolean().default(true),
});

function addDuplicateNameIssues(
  values: { name: string }[],
  path: "variants" | "modifiers",
  message: string,
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  values.forEach((value, index) => {
    const key = value.name.toLowerCase();
    if (names.has(key)) {
      ctx.addIssue({
        code: "custom",
        message,
        path: [path, index, "name"],
      });
    }
    names.add(key);
  });
}

const itemFields = {
  categoryId: z.string().uuid("Choose a category."),
  name: itemNameSchema,
  description: optionalText(2000),
  availabilityStatus: z.enum(["available", "unavailable"]),
  sortOrder: sortOrderSchema,
};

export const itemInputSchema = z
  .object({
    ...itemFields,
    basePrice: priceInputSchema,
    variants: z.array(variantSchema).max(20, "Up to 20 variants are allowed."),
    modifiers: z.array(modifierSchema).max(20, "Up to 20 add-ons are allowed."),
  })
  .superRefine((value, ctx) => {
    addDuplicateNameIssues(
      value.variants,
      "variants",
      "Variant names must be unique.",
      ctx,
    );
    addDuplicateNameIssues(
      value.modifiers,
      "modifiers",
      "Add-on names must be unique.",
      ctx,
    );
  });

export const normalizedItemInputSchema = z
  .object({
    ...itemFields,
    description: normalizedOptionalText(2000),
    basePrice: baseMinorPriceSchema,
    variants: z
      .array(normalizedVariantSchema)
      .max(20, "Up to 20 variants are allowed."),
    modifiers: z
      .array(normalizedModifierSchema)
      .max(20, "Up to 20 add-ons are allowed."),
  })
  .superRefine((value, ctx) => {
    addDuplicateNameIssues(
      value.variants,
      "variants",
      "Variant names must be unique.",
      ctx,
    );
    addDuplicateNameIssues(
      value.modifiers,
      "modifiers",
      "Add-on names must be unique.",
      ctx,
    );
  });

export type ItemInput = z.output<typeof normalizedItemInputSchema>;
