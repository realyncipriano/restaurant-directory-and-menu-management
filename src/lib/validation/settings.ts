import { z } from "zod";

export const DEFAULT_SCAN_RETENTION_DAYS = 30;
export const MIN_SCAN_RETENTION_DAYS = 1;
export const MAX_SCAN_RETENTION_DAYS = 3650;

export const scanRetentionSchema = z.object({
  scanRetentionDays: z.coerce
    .number()
    .int("Enter a whole number of days.")
    .min(
      MIN_SCAN_RETENTION_DAYS,
      `Keep deleted scans for at least ${MIN_SCAN_RETENTION_DAYS} day.`,
    )
    .max(
      MAX_SCAN_RETENTION_DAYS,
      `Keep deleted scans for at most ${MAX_SCAN_RETENTION_DAYS} days.`,
    ),
});

export type ScanRetentionInput = z.input<typeof scanRetentionSchema>;

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
