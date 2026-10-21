import "server-only";

import { headers } from "next/headers";

import { hashIdentifier } from "@/lib/auth/tokens";

export type RequestMeta = {
  ipHash: string | null;
  userAgent: string | null;
};

function trustedClientIp(store: Awaited<ReturnType<typeof headers>>): string | null {
  const mode = (process.env.TRUST_PROXY ?? "none").trim().toLowerCase();
  if (mode === "none") return null;

  if (mode === "vercel") {
    const forwarded = store.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || store.get("x-real-ip")?.trim() || null;
  }

  if (mode === "proxy") {
    const forwarded = store.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || store.get("x-real-ip")?.trim() || null;
  }

  return null;
}

export async function getRequestMeta(): Promise<RequestMeta> {
  const store = await headers();
  const ip = trustedClientIp(store);

  return {
    ipHash: ip ? hashIdentifier(`ip:${ip}`) : null,
    userAgent: store.get("user-agent")?.slice(0, 500) ?? null,
  };
}
