import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { AppError, NotFoundError } from "@/lib/errors";
import { getDeletedMenuImportPage } from "@/server/services/deleted-items";
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
    const data = await getDeletedMenuImportPage(
      getDb(),
      user.id,
      importId,
      pageId,
    );
    if (data.import.restaurantId !== id) {
      throw new NotFoundError("Import page not found.");
    }

    const signedUrl = await getSignedPrivateObjectUrl(
      data.page.privateSourceObjectKey,
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
