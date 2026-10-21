import { z } from "zod";

export const appSettingsSchema = z.object({
  siteName: z
    .string()
    .trim()
    .min(1, "Enter a site name.")
    .max(80, "Site name must be 80 characters or fewer."),
  siteTagline: z
    .string()
    .trim()
    .max(160, "Tagline must be 160 characters or fewer."),
  supportEmail: z
    .string()
    .trim()
    .max(254, "Email must be 254 characters or fewer.")
    .refine(
      (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Enter a valid email address.",
    )
    .transform((value) => (value ? value.toLowerCase() : "")),
});

export type AppSettingsInput = z.output<typeof appSettingsSchema>;
