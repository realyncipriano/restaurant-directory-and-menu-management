import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { getDb } from "@/db/client";
import { getAppSettings, type AppSettings } from "./app-settings";

export const getRequestAppSettings = cache(async (): Promise<AppSettings> => {
  await connection();
  return getAppSettings(getDb());
});
