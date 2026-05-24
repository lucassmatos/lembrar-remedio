import { vi } from "vitest";
vi.hoisted(() => { process.env.LR_DEV_LOCAL = "1"; });

import { describe, it, expect, beforeEach } from "vitest";
import { migrateUser } from "./migrate-profiles-to-shared";
import { _resetDevStore, devDoc } from "../../lib/dev-store";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = "lembrar-remedio";

beforeEach(() => _resetDevStore());

// devDoc is a duck-typed dev stand-in; SDK Command types don't match its
// AnyCommand union, so cast at the call boundary.
type SendArg = Parameters<typeof devDoc.send>[0];

async function seed(item: Record<string, unknown>) {
  await devDoc.send(
    new PutCommand({ TableName: TABLE, Item: item }) as unknown as SendArg,
  );
}

async function get(pk: string, sk: string) {
  const res = await devDoc.send(
    new GetCommand({ TableName: TABLE, Key: { pk, sk } }) as unknown as SendArg,
  );
  return (res as { Item?: Record<string, unknown> }).Item ?? null;
}

describe("migration", () => {
  it("copies reminders to profile partition and removes originals after DELETE phase", async () => {
    await seed({ pk: "users", sk: "user#userA", sub: "userA" });
    await seed({ pk: "user#userA", sk: "config" });
    await seed({
      pk: "user#userA", sk: "profile#p1",
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
    });
    await seed({
      pk: "user#userA", sk: "reminder#r1",
      id: "r1", profileId: "p1",
      kind: "medication", title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      createdAt: 1,
    });

    await migrateUser("userA", { doc: devDoc as never, table: TABLE });

    // Reminder moved to profile partition
    const moved = await get("profile#p1", "reminder#r1");
    expect(moved).not.toBeNull();
    expect(moved?.id).toBe("r1");

    // Original deleted
    const orig = await get("user#userA", "reminder#r1");
    expect(orig).toBeNull();

    // Profile-meta sentinel written
    const meta = await get("profile#p1", "meta");
    expect(meta?.ownerSub).toBe("userA");
  });

  it("splits log across profiles based on reminderId in slotKey", async () => {
    await seed({ pk: "users", sk: "user#userA", sub: "userA" });
    await seed({ pk: "user#userA", sk: "config" });
    await seed({ pk: "user#userA", sk: "profile#p1", id: "p1", name: "X", color: "sage", createdAt: 1 });
    await seed({ pk: "user#userA", sk: "profile#p2", id: "p2", name: "Y", color: "clay", createdAt: 1 });
    await seed({
      pk: "user#userA", sk: "reminder#r1",
      id: "r1", profileId: "p1", kind: "medication", title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      createdAt: 1,
    });
    await seed({
      pk: "user#userA", sk: "reminder#r2",
      id: "r2", profileId: "p2", kind: "medication", title: "Y",
      schedule: { type: "daily-interval", intervalHours: 12, startTime: "09:00" },
      createdAt: 1,
    });
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    await seed({
      pk: "user#userA", sk: "log#2026-05-24",
      "r1@08:00": { taken: true, takenAt: 1 },
      "r2@09:00": { taken: true, takenAt: 2 },
      ttl,
    });

    await migrateUser("userA", { doc: devDoc as never, table: TABLE });

    const p1Log = await get("profile#p1", "log#2026-05-24");
    const p2Log = await get("profile#p2", "log#2026-05-24");

    expect((p1Log as Record<string, unknown>)["r1@08:00"]).toBeDefined();
    expect((p1Log as Record<string, unknown>)["r2@09:00"]).toBeUndefined();
    expect((p2Log as Record<string, unknown>)["r2@09:00"]).toBeDefined();
    expect((p2Log as Record<string, unknown>)["r1@08:00"]).toBeUndefined();

    // TTL preserved
    expect((p1Log as Record<string, unknown>).ttl).toBe(ttl);
  });

  it("is idempotent — running twice produces the same end state", async () => {
    await seed({ pk: "users", sk: "user#userA", sub: "userA" });
    await seed({ pk: "user#userA", sk: "config" });
    await seed({ pk: "user#userA", sk: "profile#p1", id: "p1", name: "X", color: "sage", createdAt: 1 });
    await seed({
      pk: "user#userA", sk: "reminder#r1",
      id: "r1", profileId: "p1", kind: "medication", title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      createdAt: 1,
    });

    await migrateUser("userA", { doc: devDoc as never, table: TABLE });
    // Second run should be a no-op (migrationDone flag set)
    await migrateUser("userA", { doc: devDoc as never, table: TABLE });

    const moved = await get("profile#p1", "reminder#r1");
    expect(moved?.id).toBe("r1");
    expect(await get("user#userA", "reminder#r1")).toBeNull();
  });

  it("user with no reminders/logs still gets profile-meta sentinel", async () => {
    await seed({ pk: "users", sk: "user#userA", sub: "userA" });
    await seed({ pk: "user#userA", sk: "config" });
    await seed({ pk: "user#userA", sk: "profile#p1", id: "p1", name: "X", color: "sage", createdAt: 1 });

    await migrateUser("userA", { doc: devDoc as never, table: TABLE });

    const meta = await get("profile#p1", "meta");
    expect(meta?.ownerSub).toBe("userA");
  });

  it("preserves TTL on notified items when splitting across profiles", async () => {
    await seed({ pk: "users", sk: "user#userA", sub: "userA" });
    await seed({ pk: "user#userA", sk: "config" });
    await seed({ pk: "user#userA", sk: "profile#p1", id: "p1", name: "X", color: "sage", createdAt: 1 });
    await seed({
      pk: "user#userA", sk: "reminder#r1",
      id: "r1", profileId: "p1", kind: "medication", title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      createdAt: 1,
    });
    const ttl = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
    await seed({
      pk: "user#userA", sk: "notified#2026-05-24",
      keys: ["r1@08:00"],
      ttl,
    });

    await migrateUser("userA", { doc: devDoc as never, table: TABLE });

    const p1Notified = await get("profile#p1", "notified#2026-05-24");
    expect((p1Notified as Record<string, unknown>).keys).toEqual(["r1@08:00"]);
    expect((p1Notified as Record<string, unknown>).ttl).toBe(ttl);
  });
});
