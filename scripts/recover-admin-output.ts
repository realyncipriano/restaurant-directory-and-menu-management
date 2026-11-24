export const RECOVERY_TOKEN_WARNING =
  "WARNING: The recovery link below contains a single-use token and is written to standard output. " +
  "Terminal scrollback, shell recording, CI logs, tee, and copied text can retain it. " +
  "Clear or secure those records after delivering the link.";

export function recoveryOutputLines(link: {
  email: string;
  url: string;
  mfaReset?: boolean;
}): { warning: string; lines: string[] } {
  const mfaResetLines = link.mfaReset
    ? [
        "Multi-factor authentication was disabled for this account. Re-enroll after signing in.",
      ]
    : [];

  return {
    warning: RECOVERY_TOKEN_WARNING,
    lines: [
      `Recovery link for ${link.email}:`,
      link.url,
      ...mfaResetLines,
      "This link is single-use and expires in one hour. Deliver it over a secure channel and do not paste it into shared logs.",
    ],
  };
}
