import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { ForbiddenError } from "@/lib/errors";
import { writeAuditLog } from "@/server/services/audit";
import {
  AUDIT_PAGE_SIZE,
  listAuditHistory,
} from "@/server/services/audit-history";
import type { EphemeralDb } from "./ephemeral-db";
import { openTestDb, resetTestDb, seedUser } from "../helpers/db";

describe("audit history (ephemeral PGlite)", () => {
  let handle: EphemeralDb;
  let db: DbClient;

  beforeAll(async () => {
    const opened = await openTestDb();
    handle = opened.handle;
    db = opened.db;
  });

  afterAll(async () => {
    await handle.client.close();
  });

  beforeEach(async () => {
    await resetTestDb(handle);
  });

  async function setup() {
    const admin = await seedUser(db, {
      email: "admin@example.com",
      role: "admin",
    });
    const member = await seedUser(db, { email: "member@example.com" });
    return { admin, member };
  }

  it("requires an administrator", async () => {
    const { member } = await setup();
    await expect(
      listAuditHistory(db, member.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns newest first with totals and filter options", async () => {
    const { admin } = await setup();

    await writeAuditLog(db, {
      actor: { id: admin.id, email: admin.email },
      action: "restaurant_created",
      entityType: "restaurant",
      entityId: "restaurant-1",
      details: { name: "Cafe One" },
    });
    await writeAuditLog(db, {
      actor: { id: admin.id, email: admin.email },
      action: "menu_published",
      entityType: "menu",
      entityId: "menu-1",
    });

    const result = await listAuditHistory(db, admin.id, {});
    expect(result.total).toBe(2);
    expect(result.logs[0]?.action).toBe("menu_published");
    expect(result.logs[1]?.action).toBe("restaurant_created");
    expect(result.actions).toEqual(["menu_published", "restaurant_created"]);
    expect(result.entityTypes).toEqual(["menu", "restaurant"]);
  });

  it("filters by action, entity type and actor email", async () => {
    const { admin } = await setup();
    const other = await seedUser(db, { email: "other@example.com" });

    await writeAuditLog(db, {
      actor: { id: admin.id, email: admin.email },
      action: "menu_published",
      entityType: "menu",
    });
    await writeAuditLog(db, {
      actor: { id: other.id, email: other.email },
      action: "user_login",
      entityType: "session",
    });

    const byAction = await listAuditHistory(db, admin.id, {
      action: "menu_published",
    });
    expect(byAction.total).toBe(1);
    expect(byAction.logs[0]?.entityType).toBe("menu");

    const byEntity = await listAuditHistory(db, admin.id, {
      entityType: "session",
    });
    expect(byEntity.total).toBe(1);

    const byActor = await listAuditHistory(db, admin.id, { actor: "other@" });
    expect(byActor.total).toBe(1);
    expect(byActor.logs[0]?.actorEmail).toBe(other.email);
  });

  it("paginates and clamps out-of-range pages", async () => {
    const { admin } = await setup();

    for (let index = 0; index < AUDIT_PAGE_SIZE + 5; index += 1) {
      await writeAuditLog(db, {
        actor: { id: admin.id, email: admin.email },
        action: index % 2 === 0 ? "item_updated" : "item_created",
        entityType: "menu_item",
        entityId: `item-${index}`,
      });
    }

    const first = await listAuditHistory(db, admin.id, { page: 1 });
    expect(first.logs).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.pageCount).toBe(2);

    const second = await listAuditHistory(db, admin.id, { page: 2 });
    expect(second.logs).toHaveLength(5);

    const clamped = await listAuditHistory(db, admin.id, { page: 99 });
    expect(clamped.page).toBe(2);
    expect(clamped.logs).toHaveLength(5);
  });
});
