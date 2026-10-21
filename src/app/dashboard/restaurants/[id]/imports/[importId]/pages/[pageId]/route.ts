import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { menuImportPages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import {
  AppError,
  NotFoundError,
} from "@/lib/errors";
import { getMenuImport } from "@/server/services/imports";
import { getSignedPrivateObjectUrl } from "@/server/services/storage";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string; importId: string; pageId: string }>;
  },
) {
  const user = await getCurrentUser(getDb());
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, importId, pageId } = await context.params;

  try {
    const data = await getMenuImport(getDb(), user.id, importId);
    if (data.import.restaurantId !== id) {
      throw new NotFoundError("Import page not found.");
    }

    const [page] = await getDb()
      .select()
      .from(menuImportPages)
      .where(eq(menuImportPages.id, pageId))
      .limit(1);
    if (!page || page.importId !== importId) {
      throw new NotFoundError("Import page not found.");
    }

    const signedUrl = await getSignedPrivateObjectUrl(
      page.privateSourceObjectKey,
      300,
    );
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "The page image could not be loaded." },
      { status: 500 },
    );
  }
}
