import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/db/client";
import {
  menuCategories,
  menuImportPages,
  menuImports,
} from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import {
  beginMenuImport,
  confirmMenuImport,
  processMenuImport,
} from "@/server/services/imports";
import { createMenu } from "@/server/services/menus";
import { createRestaurant } from "@/server/services/restaurants";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

const png = vi.hoisted(() =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4jwMwDC0JALoev0GybL49AAAAAElFTkSuQmCC",
    "base64",
  ),
);

const storageMock = vi.hoisted(() => ({
  buildObjectKey: (prefix: string, extension: string) =>
    `${prefix}.${extension}`,
  deletePrivateObject: vi.fn(async () => undefined),
  getSignedPrivatePutUrl: vi.fn(
    async (key: string) => `https://r2.test/${key}`,
  ),
  headPrivateObject: vi.fn(async () => ({
    contentLength: png.length,
    contentType: "image/png",
  })),
  isPrivateStorageConfigured: vi.fn(() => true),
  readPrivateObject: vi.fn(async () => png),
}));

const extractionMock = vi.hoisted(() => ({
  extractMenuItems: vi.fn(async () => ({ items: [], raw: {} })),
}));

vi.mock("@/server/services/storage", () => storageMock);
vi.mock("@/lib/extraction/openai", () => extractionMock);

const OLD_ENV = {
  provider: process.env.EXTRACTION_PROVIDER,
  key: process.env.EXTRACTION_API_KEY,
};

describe("menu import processing (ephemeral PGlite)", () => {
  let handle: EphemeralDb;
  let db: DbClient;

  beforeAll(async () => {
    process.env.EXTRACTION_PROVIDER = "openai";
    process.env.EXTRACTION_API_KEY = "test-key";
    const opened = await openTestDb();
    handle = opened.handle;
    db = opened.db;
  });

  afterAll(async () => {
    process.env.EXTRACTION_PROVIDER = OLD_ENV.provider;
    process.env.EXTRACTION_API_KEY = OLD_ENV.key;
    await handle.client.close();
  });

  beforeEach(async () => {
    await resetTestDb(handle);
    storageMock.readPrivateObject.mockClear();
    storageMock.deletePrivateObject.mockClear();
    extractionMock.extractMenuItems.mockClear();
  });

  async function setupImport(status: "processing" | "uploading") {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const restaurant = await createRestaurant(db, admin.id, {
      name: "Processing Test Kitchen",
    });
    const menu = await createMenu(db, admin.id, restaurant.id, {
      title: "Lunch",
    });
    await db
      .insert(menuCategories)
      .values({ menuId: menu.id, name: "Mains" });
    const [record] = await db
      .insert(menuImports)
      .values({
        restaurantId: restaurant.id,
        menuId: menu.id,
        uploadedBy: admin.id,
        status,
        attemptCount: 1,
        processingStartedAt:
          status === "processing" ? new Date(0) : null,
      })
      .returning();
    await db.insert(menuImportPages).values({
      importId: record!.id,
      pageNumber: 1,
      privateSourceObjectKey: "imports/test/page-1.png",
      mimeType: "image/png",
      sizeBytes: png.length,
      processingStatus: status === "processing" ? "processing" : "pending",
    });
    return { admin, restaurant, menu, record: record! };
  }

  it("reclaims a stale processing import and completes it", async () => {
    const { admin, record } = await setupImport("processing");

    await processMenuImport(db, admin.id, record.id);

    expect(extractionMock.extractMenuItems).toHaveBeenCalledOnce();
    const [updated] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, record.id));
    expect(updated?.status).toBe("needs_review");
    expect(updated?.attemptCount).toBe(2);
    expect(updated?.processingToken).toBeNull();
    expect(updated?.processingStartedAt).toBeNull();

    const [page] = await db
      .select()
      .from(menuImportPages)
      .where(eq(menuImportPages.importId, record.id));
    expect(page?.processingStatus).toBe("processed");
  });

  it("rejects a processing import that is still active", async () => {
    const { admin, record } = await setupImport("processing");
    await db
      .update(menuImports)
      .set({ processingStartedAt: new Date() })
      .where(eq(menuImports.id, record.id));

    await expect(
      processMenuImport(db, admin.id, record.id),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(extractionMock.extractMenuItems).not.toHaveBeenCalled();
  });

  it("creates presigned uploads and confirms them", async () => {
    const { admin, restaurant, menu } = await setupImport("uploading");
    const begun = await beginMenuImport(db, admin.id, restaurant.id, menu.id, [
      { name: "page.png", size: png.length, type: "image/png" },
    ]);

    expect(begun.uploads).toHaveLength(1);
    expect(begun.uploads[0]?.url).toContain("https://r2.test/");

    const [pending] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, begun.importId));
    expect(pending?.status).toBe("uploading");

    await confirmMenuImport(db, admin.id, begun.importId);

    const [uploaded] = await db
      .select()
      .from(menuImports)
      .where(eq(menuImports.id, begun.importId));
    expect(uploaded?.status).toBe("uploaded");
    expect(uploaded?.uploadCompletedAt).toBeTruthy();

    const [page] = await db
      .select()
      .from(menuImportPages)
      .where(eq(menuImportPages.importId, begun.importId));
    expect(page?.processingStatus).toBe("uploaded");
  });
});
