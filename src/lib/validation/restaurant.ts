import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => value || null);

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((value) => value || null)
  .refine(
    (value) =>
      value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Enter a valid email address.",
  )
  .transform((value) => value?.toLowerCase() ?? null);

export const restaurantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a URL slug.")
  .max(80, "Slug must be 80 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

export const restaurantInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the restaurant name.")
    .max(160, "Name must be 160 characters or fewer."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80, "Slug must be 80 characters or fewer.")
    .optional()
    .transform((value) => value || undefined)
    .refine(
      (value) =>
        value === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "Use lowercase letters, numbers, and single hyphens.",
    ),
  description: optionalText(5000),
  cuisineType: optionalText(80),
  address: optionalText(500),
  location: optionalText(160),
  contactPhone: optionalText(40),
  contactEmail: optionalEmail,
  operatingHours: optionalText(1000),
});

export const permissionUpdateSchema = z.object({
  canEditMenu: z.boolean().default(false),
  canPublishMenu: z.boolean().default(false),
  canManageRestaurant: z.boolean().default(false),
});
