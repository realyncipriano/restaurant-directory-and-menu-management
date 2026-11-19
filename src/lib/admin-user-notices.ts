const ROLE_ERROR_CODES: Record<string, string> = {
  self: "role_self",
  inactive: "role_inactive",
  passwordless: "role_passwordless",
  last_admin: "role_last_admin",
  state: "role_state",
};

const DEACTIVATE_ERROR_CODES: Record<string, string> = {
  self: "deactivate_self",
  last_admin: "deactivate_last_admin",
  state: "deactivate_state",
};

const REACTIVATE_ERROR_CODES: Record<string, string> = {
  not_deactivated: "reactivate_state",
  passwordless: "reactivate_passwordless",
};

function errorCode(
  mapping: Record<string, string>,
  reason: string | undefined,
  fallback: string,
): string {
  return reason ? (mapping[reason] ?? fallback) : fallback;
}

export function roleErrorCode(reason?: string): string {
  return errorCode(ROLE_ERROR_CODES, reason, "role_conflict");
}

export function deactivateErrorCode(reason?: string): string {
  return errorCode(DEACTIVATE_ERROR_CODES, reason, "conflict");
}

export function reactivateErrorCode(reason?: string): string {
  return errorCode(REACTIVATE_ERROR_CODES, reason, "failed");
}
