import "server-only";

import { eq } from "drizzle-orm";

import { menuImports } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { ConflictError, NotFoundError } from "@/lib/errors";

export async function lockImportForReview(
  tx: DbExecutor,
  importId: string,
  conflictMessage = "This import is not ready for review.",
): Promise<void> {
  const [locked] = await tx
    .select({ id: menuImports.id, status: menuImports.status })
    .from(menuImports)
    .where(eq(menuImports.id, importId))
    .for("update")
    .limit(1);

  if (!locked) throw new NotFoundError("Import not found.");
  if (locked.status !== "needs_review" && locked.status !== "reviewed") {
    throw new ConflictError(conflictMessage);
  }
}
