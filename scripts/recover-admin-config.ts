import { parseRecoveryAppUrl } from "../src/lib/recovery-url";

export type AdminRecoveryConfig = {
  email: string;
  appUrl: string;
  authSecret: string;
  allowDevelopmentUrl: boolean;
  disableMfa: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function required(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/**
 * Validates every recovery input before the CLI opens a database connection.
 * Errors intentionally name variables but never echo their values.
 *
 * The production-safe URL policy is the default. Relaxing it requires both an
 * explicit development environment and `RECOVER_ADMIN_ALLOW_DEV_URL=1`, so an
 * accidentally unset or misspelled NODE_ENV fails closed instead of silently
 * permitting an HTTP or private recovery URL.
 */
export function readAdminRecoveryConfig(
  env: Record<string, string | undefined>,
  nodeEnv: string | undefined = env.NODE_ENV,
): AdminRecoveryConfig {
  const email = required(env, "RECOVER_ADMIN_EMAIL").toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("RECOVER_ADMIN_EMAIL must be a valid email address.");
  }

  if (required(env, "RECOVER_ADMIN_CONFIRM") !== "1") {
    throw new Error(
      "Set RECOVER_ADMIN_CONFIRM=1 to confirm the administrator recovery operation.",
    );
  }

  const authSecret = required(env, "AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }

  const allowDevelopmentUrl =
    env.RECOVER_ADMIN_ALLOW_DEV_URL?.trim() === "1";
  const environment = nodeEnv?.trim().toLowerCase();

  if (
    allowDevelopmentUrl &&
    environment !== "development" &&
    environment !== "test"
  ) {
    throw new Error(
      "RECOVER_ADMIN_ALLOW_DEV_URL is only allowed when NODE_ENV is development or test.",
    );
  }

  const rawAppUrl = required(env, "APP_URL");
  const appUrl = parseRecoveryAppUrl(rawAppUrl, { allowDevelopmentUrl });
  const disableMfa = env.RECOVER_ADMIN_DISABLE_MFA?.trim() === "1";

  return { email, appUrl, authSecret, allowDevelopmentUrl, disableMfa };
}
