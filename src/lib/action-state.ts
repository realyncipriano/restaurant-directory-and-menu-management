export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

export type InviteFormState = FormState & {
  inviteUrl?: string;
  inviteEmail?: string;
};

export const EMPTY_FORM_STATE: FormState = {};
export const EMPTY_INVITE_STATE: InviteFormState = {};

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/login") || value.startsWith("/activate")) {
    return "/dashboard";
  }
  return value;
}
