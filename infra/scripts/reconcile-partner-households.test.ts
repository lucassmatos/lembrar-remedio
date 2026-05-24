import { vi } from "vitest";
vi.hoisted(() => { process.env.LR_DEV_LOCAL = "1"; });

import { describe, it, expect, beforeEach } from "vitest";
import { reconcilePartnerHouseholds } from "./reconcile-partner-households";
import { _resetDevStore, devDoc } from "../../lib/dev-store";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = "lembrar-remedio";

beforeEach(() => _resetDevStore());

type SendArg = Parameters<typeof devDoc.send>[0];

async function seed(item: Record<string, unknown>) {
  await devDoc.send(new PutCommand({ TableName: TABLE, Item: item }) as unknown as SendArg);
}
async function get(pk: string, sk: string) {
  const res = await devDoc.send(
    new GetCommand({ TableName: TABLE, Key: { pk, sk } }) as unknown as SendArg,
  );
  return (res as { Item?: Record<string, unknown> }).Item ?? null;
}

// Seeds the pre-fix Lucas+Priscilla state: Lucas's profile is already shared
// with Priscilla (the old one-directional invite), but Priscilla's own profile
// was never shared back to Lucas.
async function seedAsymmetricPair() {
  await seed({ pk: "users", sk: "user#lucas", sub: "lucas" });
  await seed({ pk: "users", sk: "user#pri", sub: "pri" });
  await seed({ pk: "user#lucas", sk: "partner", partnerSub: "pri", since: 1 });
  await seed({ pk: "user#pri", sk: "partner", partnerSub: "lucas", since: 1 });
  await seed({
    pk: "user#lucas", sk: "profile#lm",
    id: "lm", name: "Lucas Matheus", color: "sky", createdAt: 1,
    ownerSub: "lucas", sharedWith: [{ sub: "pri", role: "partner", addedAt: 1 }], version: 2,
  });
  await seed({
    pk: "user#pri", sk: "profile#pr",
    id: "pr", name: "Priscilla", color: "sage", createdAt: 2,
    ownerSub: "pri", sharedWith: [], version: 1,
  });
  // Priscilla already has the link to Lucas's profile; Lucas has none to hers.
  await seed({
    pk: "user#pri", sk: "shared#lucas#lm",
    ownerSub: "lucas", profileId: "lm", role: "partner", addedAt: 1,
  });
}

describe("reconcilePartnerHouseholds", () => {
  it("backfills the missing direction so the household is symmetric", async () => {
    await seedAsymmetricPair();

    const report = await reconcilePartnerHouseholds({ doc: devDoc as never, table: TABLE });

    // Priscilla's profile now carries Lucas in sharedWith (for notify fan-out)
    const pr = await get("user#pri", "profile#pr");
    expect(pr?.sharedWith).toContainEqual(expect.objectContaining({ sub: "lucas", role: "partner" }));

    // Lucas now has a share-link to Priscilla's profile (for discovery + auth)
    const link = await get("user#lucas", "shared#pri#pr");
    expect(link).not.toBeNull();
    expect(link?.role).toBe("partner");

    // Lucas's already-shared profile was untouched (no duplicate entry)
    const lm = await get("user#lucas", "profile#lm");
    expect((lm?.sharedWith as unknown[]).length).toBe(1);

    expect(report.sharedWithAdded).toBe(1);
    expect(report.linksAdded).toBe(1);
  });

  it("is idempotent: a second run changes nothing", async () => {
    await seedAsymmetricPair();
    await reconcilePartnerHouseholds({ doc: devDoc as never, table: TABLE });
    const second = await reconcilePartnerHouseholds({ doc: devDoc as never, table: TABLE });
    expect(second.sharedWithAdded).toBe(0);
    expect(second.linksAdded).toBe(0);
  });

  it("dry-run writes nothing", async () => {
    await seedAsymmetricPair();
    await reconcilePartnerHouseholds({ doc: devDoc as never, table: TABLE, dryRun: true });
    const pr = await get("user#pri", "profile#pr");
    expect(pr?.sharedWith).toEqual([]);
    expect(await get("user#lucas", "shared#pri#pr")).toBeNull();
  });

  it("skips users without a partner record", async () => {
    await seed({ pk: "users", sk: "user#solo", sub: "solo" });
    await seed({
      pk: "user#solo", sk: "profile#s1",
      id: "s1", name: "Solo", color: "sky", createdAt: 1, ownerSub: "solo", sharedWith: [], version: 1,
    });
    const report = await reconcilePartnerHouseholds({ doc: devDoc as never, table: TABLE });
    expect(report.pairsProcessed).toBe(0);
    expect(report.sharedWithAdded).toBe(0);
  });
});
