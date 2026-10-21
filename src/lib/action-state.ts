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
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/dashboard";

  try {
    const base = "https://app.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/dashboard";
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
      return "/dashboard";
    }

    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.includes("\\")) return "/dashboard";
    if (
      decodedPath === "/login" ||
      decodedPath.startsWith("/login/") ||
      decodedPath === "/activate" ||
      decodedPath.startsWith("/activate/")
    ) {
      return "/dashboard";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
