import { z } from "zod";

import { parsePriceToMinor } from "@/lib/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .optional()
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

const variantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a variant name.")
    .max(120, "Variant name must be 120 characters or fewer."),
  price: requiredPriceSchema,
});

const modifierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter an add-on name.")
    .max(120, "Add-on name must be 120 characters or fewer."),
  price: priceInputSchema.transform((value) => value ?? 0),
  isAvailable: z.boolean().default(true),
});

export const itemInputSchema = z
  .object({
    categoryId: z.string().uuid("Choose a category."),
    name: z
      .string()
      .trim()
      .min(1, "Enter an item name.")
      .max(160, "Item name must be 160 characters or fewer."),
    description: optionalText(2000),
    basePrice: priceInputSchema,
    availabilityStatus: z.enum(["available", "unavailable"]),
    sortOrder: sortOrderSchema,
    variants: z.array(variantSchema).max(20, "Up to 20 variants are allowed."),
    modifiers: z.array(modifierSchema).max(20, "Up to 20 add-ons are allowed."),
  })
  .superRefine((value, ctx) => {
    const variantNames = new Set<string>();
    value.variants.forEach((variant, index) => {
      const key = variant.name.toLowerCase();
      if (variantNames.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Variant names must be unique.",
          path: ["variants", index, "name"],
        });
      }
      variantNames.add(key);
    });

    const modifierNames = new Set<string>();
    value.modifiers.forEach((modifier, index) => {
      const key = modifier.name.toLowerCase();
      if (modifierNames.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Add-on names must be unique.",
          path: ["modifiers", index, "name"],
        });
      }
      modifierNames.add(key);
    });
  });

export type ItemInput = z.output<typeof itemInputSchema>;
