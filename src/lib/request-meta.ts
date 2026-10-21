import "server-only";

import { headers } from "next/headers";

import { hashIdentifier } from "@/lib/auth/tokens";

export type RequestMeta = {
  ipHash: string;
  userAgent: string | null;
};

export async function getRequestMeta(): Promise<RequestMeta> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  const ip =
    firstForwarded || store.get("x-real-ip")?.trim() || "unknown-client";

  return {
    ipHash: hashIdentifier(`ip:${ip}`),
    userAgent: store.get("user-agent")?.slice(0, 500) ?? null,
  };
}
