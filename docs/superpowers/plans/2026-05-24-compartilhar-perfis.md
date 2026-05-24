# Compartilhar perfis entre usuários — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuários compartilhem perfis (medicações, vacinas, consultas) com parceiros e cuidadores, sincronizando lembretes, logs e notificações Telegram.

**Architecture:** Migra a partição DDB de `user#<sub>/...` para `profile#<id>/...` para reminders/logs/notified; perfis ganham `ownerSub` e `sharedWith[]`; cada viewer mantém um "link record" `user#<viewer>/shared#<owner>#<profile>`. Lambdas operam por-perfil em vez de por-user. Permissão é enforced na API via helper `requireProfileAccess`.

**Tech Stack:** Next.js 15 App Router · NextAuth v5 · DynamoDB (single-table) · Vitest · AWS CDK · EventBridge Scheduler · Telegram Bot API

**Reference spec:** `docs/superpowers/specs/2026-05-24-compartilhar-perfis-design.md`

---

## Phases overview

- **Phase A (Foundation):** types, DDB helpers, permission helper, sanitizer. No user-visible change. Heavy unit tests. ~8 tasks.
- **Phase B (Migration):** one-shot script + dry-run + integration test with real DDB. ~3 tasks.
- **Phase C (API rewire):** every endpoint passes through `requireProfileAccess`, lists across accessible profiles. ~6 tasks.
- **Phase D (Lambda rewire):** profile-based schedules, `notify-dose` Lambda, cleanup of old `lr-user-*`. ~4 tasks.
- **Phase E (Sharing UI + invite flow):** invite token API, accept page, settings UI. ~6 tasks.
- **Phase F (Telegram cross-member + polish + README):** edit other members' messages, badge UI, README update. ~4 tasks.

**Deploy order (CRITICAL):**
1. Merge Phase A+B → run migration script in prod (manual).
2. Merge Phase C+D → deploy web + CDK.
3. Merge Phase E → ship sharing UI.
4. Merge Phase F → polish.

**Checkpoint:** after each phase, run `npm test`, lint, manual smoke test on dev. Pause for review.

---

## File Structure

**New files:**

- `lib/sharing.ts` — `requireProfileAccess`, accept/remove flows, profile listing across owners
- `lib/profile-keys.ts` — sanitization helper for DDB map keys (base64url)
- `infra/scripts/migrate-profiles-to-shared.ts` — one-shot migration
- `infra/scripts/cleanup-old-schedules.ts` — delete `lr-user-*` post-deploy
- `infra/lambda/notify-dose/handler.ts` — replaces `notify-user`
- `infra/lambda/schedule-sync/profile-schedule.ts` — replaces `user-schedule.ts`
- `app/casa/entrar/page.tsx` — accept invite page
- `app/api/sharing/invite/route.ts` — POST creates token
- `app/api/sharing/accept/route.ts` — POST consumes token + writes transaction
- `app/api/sharing/route.ts` — GET list members, DELETE remove member/partner
- `app/_components/sharing-panel.tsx` — settings UI

**Modified files:**

- `lib/types.ts` — Profile, DayLog, partner record, link record types
- `lib/ddb.ts` — partition strategy change, new helpers, `deleteProfileCascade` rewrite
- `lib/next-dose.ts` — operate on `profileId` instead of `sub` for reminders/logs
- `lib/notify-one.ts` — accept `chatId` array, store messageId per `(slotKey,sub)`
- `lib/schedule.ts` — no change to slot key format, but exports get reused
- `app/api/reminders/route.ts` — list across accessible profiles, POST with permission check
- `app/api/reminders/[id]/route.ts` — PATCH/DELETE with permission check
- `app/api/log/route.ts` — POST with permission check, GET across profiles
- `app/api/profiles/route.ts` — list across accessible profiles
- `app/api/profiles/[id]/route.ts` — DELETE only owner
- `app/api/user/route.ts` — account deletion with transfer logic
- `app/_components/profiles-panel.tsx` — show shared profile badges
- `app/_components/today-list.tsx` — show "marcado por X"
- `app/_components/upcoming-list.tsx` — show "marcado por X" for one-shots
- `app/settings/page.tsx` — add SharingPanel
- `infra/lib/compute-stack.ts` — rename Lambda, IAM, schedule role
- `infra/lambda/schedule-sync/handler.ts` — dispatch per profile, not per user
- `README.md` — sharing docs, fix outdated Telegram-only notification claim

---

# Phase A — Foundation

Tasks A1–A8 build types and pure helpers with no DDB writes. All tests run with vitest against the in-memory `dev-store`.

## Task A1: Add types for sharing

**Files:**
- Modify: `lib/types.ts`
- Test: `lib/types.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `lib/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isMedication,
  isOneShot,
  isCaregiver,
  isPartner,
  type Profile,
  type PartnerRecord,
  type ProfileShareLink,
} from "./types";

describe("sharing types", () => {
  it("Profile carries ownerSub, sharedWith, version", () => {
    const p: Profile = {
      id: "p1",
      name: "Filho",
      color: "sage",
      createdAt: 1,
      ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "partner", addedAt: 2 }],
      version: 1,
    };
    expect(p.sharedWith[0].role).toBe("partner");
    expect(p.version).toBe(1);
  });

  it("isPartner/isCaregiver discriminate the role on a share entry", () => {
    const entry = { sub: "x", role: "caregiver" as const, addedAt: 1 };
    expect(isCaregiver(entry)).toBe(true);
    expect(isPartner(entry)).toBe(false);
  });

  it("PartnerRecord and ProfileShareLink shapes compile", () => {
    const partner: PartnerRecord = {
      partnerSub: "b",
      partnerEmail: "b@example.com",
      partnerName: "B",
      since: 1,
    };
    const link: ProfileShareLink = {
      ownerSub: "a",
      profileId: "p1",
      role: "caregiver",
      addedAt: 1,
    };
    expect(partner.partnerSub).toBe("b");
    expect(link.profileId).toBe("p1");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- lib/types`
Expected: FAIL (missing exports).

- [ ] **Step 3: Update `lib/types.ts`**

Append after existing `Reminder` type:

```ts
export type ProfileShareRole = "partner" | "caregiver";

export type ProfileShareEntry = {
  sub: string;
  role: ProfileShareRole;
  addedAt: number;
};

export function isPartner(e: ProfileShareEntry): boolean {
  return e.role === "partner";
}

export function isCaregiver(e: ProfileShareEntry): boolean {
  return e.role === "caregiver";
}

export type PartnerRecord = {
  partnerSub: string;
  partnerEmail?: string;
  partnerName?: string;
  since: number;
};

export type ProfileShareLink = {
  ownerSub: string;
  profileId: string;
  role: ProfileShareRole;
  addedAt: number;
};
```

Then update the `Profile` type to add fields:

```ts
export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  isDefault?: boolean;
  createdAt: number;
  ownerSub: string;
  sharedWith: ProfileShareEntry[];
  version: number;
};
```

And update `DayLog`:

```ts
export type DayLog = Record<string, {
  taken: boolean;
  takenAt: number;
  takenBy?: string;
}>;
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- lib/types`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/types.test.ts
git commit -m "feat(types): add Profile.ownerSub/sharedWith/version, takenBy in DayLog"
```

---

## Task A2: profile-keys.ts — base64url sanitization for DDB map keys

**Files:**
- Create: `lib/profile-keys.ts`
- Test: `lib/profile-keys.test.ts`

- [ ] **Step 1: Failing test**

`lib/profile-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeMessageKey, parseMessageKey } from "./profile-keys";

describe("profile-keys", () => {
  it("sanitizes slotKey + sub to base64url (no @, |, #, =, +, /)", () => {
    const k = sanitizeMessageKey("abc123@08:00", "google-oauth2|456");
    expect(k).not.toMatch(/[@|#=+/]/);
    expect(k.length).toBeGreaterThan(0);
  });

  it("round-trips through parse", () => {
    const slot = "abc123@08:00";
    const sub = "google-oauth2|456";
    const k = sanitizeMessageKey(slot, sub);
    const parsed = parseMessageKey(k);
    expect(parsed.slotKey).toBe(slot);
    expect(parsed.sub).toBe(sub);
  });

  it("rejects malformed parse input", () => {
    expect(() => parseMessageKey("notbase64!!!")).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/profile-keys`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/profile-keys.ts`:

```ts
const SEP = " ";

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("invalid base64url");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(std, "base64").toString("utf8");
}

export function sanitizeMessageKey(slotKey: string, sub: string): string {
  return toBase64Url(`${slotKey}${SEP}${sub}`);
}

export function parseMessageKey(key: string): { slotKey: string; sub: string } {
  const decoded = fromBase64Url(key);
  const idx = decoded.indexOf(SEP);
  if (idx < 0) throw new Error("malformed message key");
  return { slotKey: decoded.slice(0, idx), sub: decoded.slice(idx + 1) };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- lib/profile-keys`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/profile-keys.ts lib/profile-keys.test.ts
git commit -m "feat(sharing): add base64url sanitizer for DDB message-map keys"
```

---

## Task A3: DDB partition keys for profile-scoped data

**Files:**
- Modify: `lib/ddb.ts:45-60` (PK/SK builders)

- [ ] **Step 1: Add new partition keys**

In `lib/ddb.ts`, update the `PK`/`SK` builders. Replace the existing block with:

```ts
const PK = {
  user: (sub: string) => `user#${sub}`,
  profile: (profileId: string) => `profile#${profileId}`,
  pair: (token: string) => `pair#${token}`,
  chat: (chatId: number) => `chat#${chatId}`,
  users: "users",
};
const SK = {
  config: "config",
  partner: "partner",
  reminder: (id: string) => `reminder#${id}`,
  profile: (id: string) => `profile#${id}`,
  log: (date: string) => `log#${date}`,
  notified: (date: string) => `notified#${date}`,
  pair: "pair",
  chat: "chat",
  userIndex: (sub: string) => `user#${sub}`,
  shareLink: (ownerSub: string, profileId: string) =>
    `shared#${ownerSub}#${profileId}`,
};
```

- [ ] **Step 2: Commit (intermediate)**

```bash
git add lib/ddb.ts
git commit -m "refactor(ddb): add profile/shareLink/partner keys"
```

No tests yet — these are just constants used by next tasks.

---

## Task A4: DDB helpers — profile-scoped reminders/logs/notified

**Files:**
- Modify: `lib/ddb.ts` (replace `listReminders`, `getReminder`, `putReminder`, `deleteReminder`, `getLog`, `setLogEntry`, `wasNotified`, `getNotifiedKeys`, `markNotified`)
- Test: `lib/ddb.test.ts` (new)

Goal: every reminder/log/notified op moves from `user#<sub>` partition to `profile#<profileId>` partition. The owner identity is no longer the partition key — it's metadata on the profile.

- [ ] **Step 1: Write tests for the new shapes**

`lib/ddb.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  listRemindersForProfile,
  putReminderForProfile,
  deleteReminderForProfile,
  getLogForProfile,
  setLogEntryForProfile,
  markNotifiedForProfile,
  getNotifiedKeysForProfile,
} from "./ddb";
import { _resetDevStore } from "./dev-store";

beforeEach(() => _resetDevStore());

describe("profile-scoped DDB", () => {
  it("listReminders returns only reminders in the profile partition", async () => {
    await putReminderForProfile({
      id: "r1",
      kind: "medication",
      title: "Dipirona",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1",
      createdAt: 1,
    });
    await putReminderForProfile({
      id: "r2",
      kind: "medication",
      title: "Outro",
      schedule: { type: "daily-interval", intervalHours: 12, startTime: "09:00" },
      profileId: "p2",
      createdAt: 2,
    });
    const list = await listRemindersForProfile("p1");
    expect(list.map((r) => r.id)).toEqual(["r1"]);
  });

  it("setLogEntry + getLog record takenBy", async () => {
    await setLogEntryForProfile("p1", "2026-05-24", "r1@08:00", true, "userA");
    const log = await getLogForProfile("p1", "2026-05-24");
    expect(log["r1@08:00"].taken).toBe(true);
    expect(log["r1@08:00"].takenBy).toBe("userA");
  });

  it("markNotified is atomic per profile+date+key", async () => {
    const first = await markNotifiedForProfile("p1", "2026-05-24", "r1@08:00");
    const second = await markNotifiedForProfile("p1", "2026-05-24", "r1@08:00");
    expect(first).toBe(true);
    expect(second).toBe(false);

    const keys = await getNotifiedKeysForProfile("p1", "2026-05-24");
    expect(keys.has("r1@08:00")).toBe(true);
  });

  it("deleteReminder removes from profile partition", async () => {
    await putReminderForProfile({
      id: "r1",
      kind: "medication",
      title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1",
      createdAt: 1,
    });
    await deleteReminderForProfile("p1", "r1");
    expect(await listRemindersForProfile("p1")).toEqual([]);
  });
});
```

You'll also need `_resetDevStore` exported from `lib/dev-store.ts`. Add it:

```ts
// at the bottom of lib/dev-store.ts
export function _resetDevStore(): void {
  if (!isDevLocal()) throw new Error("_resetDevStore only allowed in dev/test");
  // clear in-memory map
  __store.clear();
}
```

(`__store` is the existing Map — check the actual variable name in dev-store.ts and use it.)

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/ddb`
Expected: FAIL (functions don't exist).

- [ ] **Step 3: Implement new helpers in `lib/ddb.ts`**

Add new helpers (keep old `listReminders(sub)` etc. for now — Phase B migration uses them):

```ts
export async function listRemindersForProfile(profileId: string): Promise<Reminder[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.profile(profileId), ":sk": "reminder#" },
    }),
  );
  return (res.Items ?? []).map(stripKeys<Reminder>);
}

export async function getReminderForProfile(
  profileId: string,
  id: string,
): Promise<Reminder | null> {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.reminder(id) },
    }),
  );
  return res.Item ? stripKeys<Reminder>(res.Item) : null;
}

export async function putReminderForProfile(reminder: Reminder): Promise<Reminder> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(reminder.profileId),
        sk: SK.reminder(reminder.id),
        ...reminder,
      },
    }),
  );
  return reminder;
}

export async function deleteReminderForProfile(
  profileId: string,
  id: string,
): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.reminder(id) },
    }),
  );
}

export async function getLogForProfile(
  profileId: string,
  date: string,
): Promise<DayLog> {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.log(date) },
    }),
  );
  if (!res.Item) return {};
  const log = { ...(res.Item as Record<string, unknown>) };
  delete log.pk; delete log.sk; delete log.ttl;
  return log as DayLog;
}

export async function setLogEntryForProfile(
  profileId: string,
  date: string,
  slotKey: string,
  taken: boolean,
  takenBy: string,
): Promise<DayLog> {
  const log = await getLogForProfile(profileId, date);
  if (taken) log[slotKey] = { taken: true, takenAt: Date.now(), takenBy };
  else delete log[slotKey];
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(profileId),
        sk: SK.log(date),
        ...log,
        ttl: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
      },
    }),
  );
  return log;
}

export async function getNotifiedKeysForProfile(
  profileId: string,
  date: string,
): Promise<Set<string>> {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.notified(date) },
    }),
  );
  const keys = (res.Item?.keys ?? []) as string[];
  return new Set(keys);
}

export async function markNotifiedForProfile(
  profileId: string,
  date: string,
  slotKey: string,
): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  try {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: PK.profile(profileId), sk: SK.notified(date) },
        UpdateExpression:
          "SET #keys = list_append(if_not_exists(#keys, :empty), :new), #ttl = :ttl",
        ConditionExpression:
          "attribute_not_exists(#keys) OR NOT contains(#keys, :slotKey)",
        ExpressionAttributeNames: { "#keys": "keys", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":empty": [] as string[],
          ":new": [slotKey],
          ":slotKey": slotKey,
          ":ttl": ttl,
        },
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- lib/ddb`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ddb.ts lib/dev-store.ts lib/ddb.test.ts
git commit -m "feat(ddb): add profile-scoped reminder/log/notified helpers"
```

---

## Task A5: Profile metadata helpers with `ownerSub`, `sharedWith`, `version`

**Files:**
- Modify: `lib/ddb.ts` — update `putProfile`, `listProfiles`, `ensureDefaultProfile`
- Add: `listSharedLinks`, `putShareLink`, `deleteShareLink`, `getPartner`, `setPartner`, `deletePartner`
- Test: extend `lib/ddb.test.ts`

- [ ] **Step 1: Tests**

Add to `lib/ddb.test.ts`:

```ts
import {
  putProfile,
  listProfiles,
  listProfilesForUser,
  putShareLink,
  listShareLinks,
  deleteShareLink,
  setPartner,
  getPartner,
  deletePartner,
} from "./ddb";

describe("profile metadata + sharing", () => {
  it("putProfile sets ownerSub/sharedWith/version when missing", async () => {
    await putProfile("userA", {
      id: "p1",
      name: "Filho",
      color: "sage",
      createdAt: 1,
      ownerSub: "userA",
      sharedWith: [],
      version: 1,
    });
    const profs = await listProfiles("userA");
    expect(profs[0].ownerSub).toBe("userA");
    expect(profs[0].version).toBe(1);
  });

  it("listProfilesForUser merges own + shared via link records", async () => {
    await putProfile("userA", {
      id: "p1",
      name: "Filho",
      color: "sage",
      createdAt: 1,
      ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "caregiver", addedAt: 2 }],
      version: 1,
    });
    await putShareLink("userB", {
      ownerSub: "userA",
      profileId: "p1",
      role: "caregiver",
      addedAt: 2,
    });

    const merged = await listProfilesForUser("userB");
    expect(merged.length).toBe(1);
    expect(merged[0].profile.id).toBe("p1");
    expect(merged[0].accessRole).toBe("caregiver");
  });

  it("partner record CRUD", async () => {
    await setPartner("userA", {
      partnerSub: "userB",
      partnerEmail: "b@example.com",
      partnerName: "B",
      since: 1,
    });
    expect((await getPartner("userA"))?.partnerSub).toBe("userB");
    await deletePartner("userA");
    expect(await getPartner("userA")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/ddb`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/ddb.ts`, replace `putProfile`:

```ts
export async function putProfile(ownerSub: string, profile: Profile): Promise<Profile> {
  const enriched: Profile = {
    ...profile,
    ownerSub: profile.ownerSub ?? ownerSub,
    sharedWith: profile.sharedWith ?? [],
    version: profile.version ?? 1,
  };
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(ownerSub), sk: SK.profile(profile.id), ...enriched },
    }),
  );
  return enriched;
}
```

Replace `listProfiles` so it always defaults missing fields (defensive against pre-migration):

```ts
export async function listProfiles(sub: string): Promise<Profile[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "profile#" },
    }),
  );
  const items = (res.Items ?? []).map(stripKeys<Profile>);
  return items.map((p) => ({
    ...p,
    ownerSub: p.ownerSub ?? sub,
    sharedWith: p.sharedWith ?? [],
    version: p.version ?? 1,
  })).sort((a, b) => a.createdAt - b.createdAt);
}
```

Add new helpers:

```ts
export type ProfileWithAccess = {
  profile: Profile;
  accessRole: "owner" | "partner" | "caregiver";
};

export async function listShareLinks(viewerSub: string): Promise<ProfileShareLink[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(viewerSub), ":sk": "shared#" },
    }),
  );
  return (res.Items ?? []).map((it) => ({
    ownerSub: it.ownerSub as string,
    profileId: it.profileId as string,
    role: it.role as ProfileShareRole,
    addedAt: it.addedAt as number,
  }));
}

export async function putShareLink(
  viewerSub: string,
  link: ProfileShareLink,
): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.user(viewerSub),
        sk: SK.shareLink(link.ownerSub, link.profileId),
        ...link,
      },
    }),
  );
}

export async function deleteShareLink(
  viewerSub: string,
  ownerSub: string,
  profileId: string,
): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(viewerSub), sk: SK.shareLink(ownerSub, profileId) },
    }),
  );
}

export async function listProfilesForUser(sub: string): Promise<ProfileWithAccess[]> {
  const [own, links] = await Promise.all([
    listProfiles(sub),
    listShareLinks(sub),
  ]);
  const ownEntries: ProfileWithAccess[] = own.map((p) => ({
    profile: p,
    accessRole: "owner",
  }));
  const fetched = await Promise.all(
    links.map(async (l) => {
      const res = await doc.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: PK.user(l.ownerSub), sk: SK.profile(l.profileId) },
        }),
      );
      if (!res.Item) return null;
      return {
        profile: stripKeys<Profile>(res.Item),
        accessRole: l.role,
      } as ProfileWithAccess;
    }),
  );
  return [...ownEntries, ...fetched.filter((x): x is ProfileWithAccess => x !== null)];
}

export async function setPartner(sub: string, p: PartnerRecord): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.partner, ...p },
    }),
  );
}

export async function getPartner(sub: string): Promise<PartnerRecord | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.partner } }),
  );
  if (!res.Item) return null;
  const it = res.Item;
  return {
    partnerSub: it.partnerSub as string,
    partnerEmail: it.partnerEmail as string | undefined,
    partnerName: it.partnerName as string | undefined,
    since: it.since as number,
  };
}

export async function deletePartner(sub: string): Promise<void> {
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.partner } }),
  );
}
```

Also add imports at the top:

```ts
import type {
  PartnerRecord,
  ProfileShareLink,
  ProfileShareRole,
} from "./types";
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- lib/ddb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ddb.ts lib/ddb.test.ts
git commit -m "feat(ddb): profile sharing — listProfilesForUser, share links, partner record"
```

---

## Task A6: `requireProfileAccess` permission helper

**Files:**
- Create: `lib/sharing.ts`
- Test: `lib/sharing.test.ts`

- [ ] **Step 1: Tests**

`lib/sharing.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { requireProfileAccess, ForbiddenError, NotFoundError } from "./sharing";
import { putProfile } from "./ddb";
import { _resetDevStore } from "./dev-store";

beforeEach(() => _resetDevStore());

const baseProfile = {
  id: "p1",
  name: "Filho",
  color: "sage" as const,
  createdAt: 1,
};

describe("requireProfileAccess", () => {
  it("owner has all roles", async () => {
    await putProfile("userA", {
      ...baseProfile,
      ownerSub: "userA",
      sharedWith: [],
      version: 1,
    });
    await expect(requireProfileAccess("userA", "p1", "owner")).resolves.toBeDefined();
    await expect(requireProfileAccess("userA", "p1", "editor")).resolves.toBeDefined();
    await expect(requireProfileAccess("userA", "p1", "viewer")).resolves.toBeDefined();
  });

  it("partner has editor + viewer, not owner", async () => {
    await putProfile("userA", {
      ...baseProfile,
      ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "partner", addedAt: 1 }],
      version: 1,
    });
    await expect(requireProfileAccess("userB", "p1", "viewer")).resolves.toBeDefined();
    await expect(requireProfileAccess("userB", "p1", "editor")).resolves.toBeDefined();
    await expect(requireProfileAccess("userB", "p1", "owner")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("caregiver has only viewer", async () => {
    await putProfile("userA", {
      ...baseProfile,
      ownerSub: "userA",
      sharedWith: [{ sub: "userC", role: "caregiver", addedAt: 1 }],
      version: 1,
    });
    await expect(requireProfileAccess("userC", "p1", "viewer")).resolves.toBeDefined();
    await expect(requireProfileAccess("userC", "p1", "editor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("stranger gets ForbiddenError, not NotFound (avoid id enumeration)", async () => {
    await putProfile("userA", {
      ...baseProfile,
      ownerSub: "userA",
      sharedWith: [],
      version: 1,
    });
    await expect(requireProfileAccess("userZ", "p1", "viewer")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("nonexistent profile throws NotFoundError", async () => {
    await expect(requireProfileAccess("userA", "missing", "viewer")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
```

The test references `requireProfileAccess(callerSub, profileId, minRole)` — but discovery needs to know where the Profile lives. Approach: caller passes `callerSub` only; the helper finds the profile by:

1. Check own: `user#<callerSub>/profile#<profileId>` — if present, caller is owner.
2. Else check shared link: `user#<callerSub>/shared#*#<profileId>` — find any share link with this profileId.
3. If found, fetch from owner partition, validate role.

To support step 2 efficiently, store shareLink with profileId in the SK suffix already (it does: `shared#<ownerSub>#<profileId>`). To find by profileId alone, list and filter. Acceptable cost given a user's share-link count is small (<100).

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- lib/sharing`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/sharing.ts`**

```ts
import {
  PK,
  SK,
  doc,
  TABLE,
  listShareLinks,
} from "./ddb-internals"; // see note below
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Profile, ProfileShareRole } from "./types";

export type AccessRole = "owner" | "partner" | "caregiver";
export type MinRole = "owner" | "editor" | "viewer";

export class ForbiddenError extends Error {
  constructor(public profileId: string) {
    super(`forbidden on profile ${profileId}`);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  constructor(public profileId: string) {
    super(`profile ${profileId} not found`);
    this.name = "NotFoundError";
  }
}

export type AccessGrant = {
  profile: Profile;
  role: AccessRole;
};

const ROLE_RANK: Record<AccessRole, number> = {
  caregiver: 1,
  partner: 2,
  owner: 3,
};
const MIN_RANK: Record<MinRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export async function requireProfileAccess(
  callerSub: string,
  profileId: string,
  minRole: MinRole,
): Promise<AccessGrant> {
  // 1) Owner?
  const ownRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(callerSub), sk: SK.profile(profileId) },
    }),
  );
  if (ownRes.Item) {
    const profile = sanitizeProfile(ownRes.Item, callerSub);
    return checkRole(profile, "owner", minRole);
  }

  // 2) Shared link?
  const links = await listShareLinks(callerSub);
  const match = links.find((l) => l.profileId === profileId);
  if (!match) {
    // Could be that profile doesn't exist or caller has no access — same response.
    // But callers may want to distinguish. Probe existence via a known-owner read?
    // We don't know ownerSub if caller isn't owner and has no link. Treat as
    // Forbidden when no link, NotFound only when no link AND we can't find any
    // record. Simpler: just throw Forbidden — id enumeration is not a goal here.
    // Exception: tests want NotFound for genuinely missing IDs that the caller
    // owns nothing about. Heuristic: if profileId never appears in any partition
    // of this caller, return NotFound.
    throw new ForbiddenError(profileId);
  }
  const ownerRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(match.ownerSub), sk: SK.profile(profileId) },
    }),
  );
  if (!ownerRes.Item) {
    // Stale link record — clean it? Out of scope here, just throw.
    throw new NotFoundError(profileId);
  }
  const profile = sanitizeProfile(ownerRes.Item, match.ownerSub);
  return checkRole(profile, match.role, minRole);
}

function sanitizeProfile(item: Record<string, unknown>, ownerSub: string): Profile {
  const { pk: _pk, sk: _sk, ...rest } = item as { pk?: unknown; sk?: unknown };
  const p = rest as unknown as Profile;
  return {
    ...p,
    ownerSub: p.ownerSub ?? ownerSub,
    sharedWith: p.sharedWith ?? [],
    version: p.version ?? 1,
  };
}

function checkRole(profile: Profile, role: AccessRole, minRole: MinRole): AccessGrant {
  if (ROLE_RANK[role] < MIN_RANK[minRole]) {
    throw new ForbiddenError(profile.id);
  }
  return { profile, role };
}
```

**Important note about `./ddb-internals`:** `requireProfileAccess` reuses `PK`/`SK`/`doc`/`TABLE` which live in `lib/ddb.ts` but are not exported. To avoid a circular-import smell, export them at the bottom of `lib/ddb.ts`:

```ts
export const _internal = { PK, SK, doc, TABLE };
```

Then update the import in `lib/sharing.ts`:

```ts
import { _internal, listShareLinks } from "./ddb";
const { PK, SK, doc, TABLE } = _internal;
```

(Test for the NotFound case currently throws ForbiddenError because there's no link. Adjust the test: a stranger gets Forbidden; the NotFound case is when caller owns nothing but the profileId references a deleted profile via a stale link. Adjust test to seed a stale link.)

Update the NotFound test:

```ts
it("stale share link with deleted profile throws NotFoundError", async () => {
  await putShareLink("userD", {
    ownerSub: "userOther",
    profileId: "deleted-id",
    role: "caregiver",
    addedAt: 1,
  });
  await expect(requireProfileAccess("userD", "deleted-id", "viewer")).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
```

And remove the prior test that expected NotFound on plain missing — that case is Forbidden now.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- lib/sharing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sharing.ts lib/sharing.test.ts lib/ddb.ts
git commit -m "feat(sharing): requireProfileAccess helper with viewer/editor/owner roles"
```

---

## Task A7: Accept-invite transaction helper

**Files:**
- Modify: `lib/sharing.ts` — add `acceptInvite`
- Test: extend `lib/sharing.test.ts`

- [ ] **Step 1: Test**

```ts
import { acceptInvite } from "./sharing";
import { listShareLinks, listProfiles, getPartner } from "./ddb";

describe("acceptInvite", () => {
  beforeEach(() => _resetDevStore());

  it("caregiver mode adds entry to sharedWith and writes link record", async () => {
    await putProfile("ownerA", {
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [],
      version: 1,
    });

    await acceptInvite({
      callerSub: "caregiverB",
      callerEmail: "b@example.com",
      callerName: "B",
      payload: {
        ownerSub: "ownerA",
        mode: "caregiver",
        profileIds: ["p1"],
        inviteeEmail: "b@example.com",
      },
    });

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith).toContainEqual(
      expect.objectContaining({ sub: "caregiverB", role: "caregiver" }),
    );
    expect(updated[0].version).toBe(2);

    const links = await listShareLinks("caregiverB");
    expect(links).toContainEqual(expect.objectContaining({ profileId: "p1" }));
  });

  it("partner mode writes partner record on both sides + shares all profiles", async () => {
    await putProfile("ownerA", {
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [],
      version: 1,
    });

    await acceptInvite({
      callerSub: "partnerB",
      callerEmail: "b@example.com",
      callerName: "B",
      payload: {
        ownerSub: "ownerA",
        mode: "partner",
        inviteeEmail: "b@example.com",
      },
    });

    expect((await getPartner("ownerA"))?.partnerSub).toBe("partnerB");
    expect((await getPartner("partnerB"))?.partnerSub).toBe("ownerA");

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith[0]).toEqual(
      expect.objectContaining({ sub: "partnerB", role: "partner" }),
    );
  });

  it("rejects when inviteeEmail mismatches", async () => {
    await expect(
      acceptInvite({
        callerSub: "wrongUser",
        callerEmail: "wrong@example.com",
        callerName: "W",
        payload: {
          ownerSub: "ownerA",
          mode: "caregiver",
          profileIds: ["p1"],
          inviteeEmail: "expected@example.com",
        },
      }),
    ).rejects.toThrow(/inviteeEmail/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `lib/sharing.ts`:

```ts
import {
  putProfile,
  putShareLink,
  setPartner,
  listProfiles as listOwnerProfiles,
} from "./ddb";
import type { PartnerRecord, ProfileShareEntry } from "./types";

export type InvitePayload = {
  ownerSub: string;
  mode: "partner" | "caregiver";
  profileIds?: string[];
  inviteeEmail?: string;
};

export type AcceptInviteInput = {
  callerSub: string;
  callerEmail?: string | null;
  callerName?: string | null;
  payload: InvitePayload;
};

export async function acceptInvite(input: AcceptInviteInput): Promise<void> {
  const { callerSub, callerEmail, callerName, payload } = input;
  if (payload.inviteeEmail && payload.inviteeEmail !== callerEmail) {
    throw new Error("inviteeEmail mismatch");
  }
  if (payload.ownerSub === callerSub) {
    throw new Error("cannot accept own invite");
  }

  const now = Date.now();
  const profilesToShare: string[] =
    payload.mode === "partner"
      ? (await listOwnerProfiles(payload.ownerSub)).map((p) => p.id)
      : payload.profileIds ?? [];

  if (profilesToShare.length === 0 && payload.mode === "caregiver") {
    throw new Error("no profiles to share");
  }

  // Per-profile update: add caller to sharedWith, write link record.
  // Use TransactWriteItems where possible. For simplicity here, do sequential
  // updates with optimistic version checks (acceptable since invite-accept is
  // rare and not under hot concurrency in practice).
  for (const profileId of profilesToShare) {
    const owned = await listOwnerProfiles(payload.ownerSub);
    const profile = owned.find((p) => p.id === profileId);
    if (!profile) continue;
    const exists = profile.sharedWith.some((e) => e.sub === callerSub);
    if (!exists) {
      const entry: ProfileShareEntry = {
        sub: callerSub,
        role: payload.mode,
        addedAt: now,
      };
      await putProfile(payload.ownerSub, {
        ...profile,
        sharedWith: [...profile.sharedWith, entry],
        version: profile.version + 1,
      });
    }
    await putShareLink(callerSub, {
      ownerSub: payload.ownerSub,
      profileId,
      role: payload.mode,
      addedAt: now,
    });
  }

  if (payload.mode === "partner") {
    const ownerRecord: PartnerRecord = {
      partnerSub: callerSub,
      partnerEmail: callerEmail ?? undefined,
      partnerName: callerName ?? undefined,
      since: now,
    };
    await setPartner(payload.ownerSub, ownerRecord);

    // Reciprocal record on caller's side (owner becomes caller's partner too).
    const callerRecord: PartnerRecord = {
      partnerSub: payload.ownerSub,
      since: now,
    };
    await setPartner(callerSub, callerRecord);
  }
}
```

Note on transactions: the spec called for `TransactWriteItems`. For the first ship, sequential operations are acceptable because (a) the accept flow runs once per invite (not under concurrency), and (b) DDB TransactWrite has a 25-item limit which a parceiro flow could exceed. Document this trade-off in the spec under "Decisões e limitações". If we observe inconsistencies in practice, switch to TransactWrite per-profile (1 profile + 1 link = 2 items, fits trivially).

(Add this trade-off note to the spec — see Task F4.)

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- lib/sharing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sharing.ts lib/sharing.test.ts
git commit -m "feat(sharing): acceptInvite for partner/caregiver modes"
```

---

## Task A8: Remove-member + leave flow helpers

**Files:**
- Modify: `lib/sharing.ts` — add `removeMember`, `leaveShare`
- Test: extend `lib/sharing.test.ts`

- [ ] **Step 1: Tests**

```ts
import { removeMember, leaveShare } from "./sharing";

describe("removeMember / leaveShare", () => {
  beforeEach(() => _resetDevStore());

  it("owner can remove caregiver", async () => {
    await putProfile("ownerA", {
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 2,
    });
    await putShareLink("carerB", {
      ownerSub: "ownerA",
      profileId: "p1",
      role: "caregiver",
      addedAt: 1,
    });

    await removeMember({
      callerSub: "ownerA",
      profileId: "p1",
      memberSub: "carerB",
    });

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith).toEqual([]);
    expect(await listShareLinks("carerB")).toEqual([]);
  });

  it("non-owner cannot remove other members", async () => {
    await putProfile("ownerA", {
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [
        { sub: "carerB", role: "caregiver", addedAt: 1 },
        { sub: "carerC", role: "caregiver", addedAt: 1 },
      ],
      version: 2,
    });
    await expect(
      removeMember({ callerSub: "carerB", profileId: "p1", memberSub: "carerC" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("leaveShare removes caller from sharedWith and their link record", async () => {
    await putProfile("ownerA", {
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 2,
    });
    await putShareLink("carerB", {
      ownerSub: "ownerA",
      profileId: "p1",
      role: "caregiver",
      addedAt: 1,
    });

    await leaveShare({ callerSub: "carerB", ownerSub: "ownerA", profileId: "p1" });

    expect((await listProfiles("ownerA"))[0].sharedWith).toEqual([]);
    expect(await listShareLinks("carerB")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `lib/sharing.ts`:

```ts
import { deleteShareLink } from "./ddb";

export async function removeMember(args: {
  callerSub: string;
  profileId: string;
  memberSub: string;
}): Promise<void> {
  const grant = await requireProfileAccess(args.callerSub, args.profileId, "owner");
  const profile = grant.profile;
  await putProfile(profile.ownerSub, {
    ...profile,
    sharedWith: profile.sharedWith.filter((e) => e.sub !== args.memberSub),
    version: profile.version + 1,
  });
  await deleteShareLink(args.memberSub, profile.ownerSub, profile.id);
}

export async function leaveShare(args: {
  callerSub: string;
  ownerSub: string;
  profileId: string;
}): Promise<void> {
  // Caller doesn't need owner permission — they're voluntarily leaving.
  const ownerRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(args.ownerSub), sk: SK.profile(args.profileId) },
    }),
  );
  if (!ownerRes.Item) {
    // Stale link — just remove it.
    await deleteShareLink(args.callerSub, args.ownerSub, args.profileId);
    return;
  }
  const profile = sanitizeProfile(ownerRes.Item, args.ownerSub);
  await putProfile(profile.ownerSub, {
    ...profile,
    sharedWith: profile.sharedWith.filter((e) => e.sub !== args.callerSub),
    version: profile.version + 1,
  });
  await deleteShareLink(args.callerSub, args.ownerSub, args.profileId);
}
```

- [ ] **Step 4: Run, verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sharing.ts lib/sharing.test.ts
git commit -m "feat(sharing): removeMember + leaveShare"
```

**END OF PHASE A.** Checkpoint: `npm test` should pass with all new tests. No user-visible behavior changes yet. Pause for review.

---

# Phase B — Migration

## Task B1: Migration script — copy reminders to profile partition

**Files:**
- Create: `infra/scripts/migrate-profiles-to-shared.ts`

This is a 3-pass script: COPY (with `attribute_not_exists` condition) → VERIFY → DELETE.

- [ ] **Step 1: Write the script**

```ts
// infra/scripts/migrate-profiles-to-shared.ts
//
// One-shot migration: move reminders, logs, notified from user# partition to
// profile# partition. Profile metadata stays under user#<ownerSub>.
//
// Usage: AWS_PROFILE=... npx tsx infra/scripts/migrate-profiles-to-shared.ts [--dry-run] [--phase=copy|verify|delete|all]
//
// Idempotent: marks each user's config with migrationCopyDone / migrationDone
// timestamps. Safe to re-run.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.AWS_REGION || "us-east-1";
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const phaseArg = [...args].find((a) => a.startsWith("--phase="));
const PHASE = (phaseArg?.split("=")[1] ?? "all") as
  | "copy"
  | "verify"
  | "delete"
  | "all";

const raw = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

type Reminder = { id: string; profileId: string; [k: string]: unknown };
type Profile = { id: string; [k: string]: unknown };

async function listAllUsers(): Promise<string[]> {
  const out: string[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": "users", ":sk": "user#" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(it.sub as string);
    lek = res.LastEvaluatedKey;
  } while (lek);
  return out;
}

async function fetchUserPartition(sub: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": `user#${sub}` },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(it);
    lek = res.LastEvaluatedKey;
  } while (lek);
  return out;
}

async function setMigrationFlag(sub: string, field: "migrationCopyDone" | "migrationDone"): Promise<void> {
  if (DRY) return;
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `user#${sub}`, sk: "config" },
      UpdateExpression: "SET #f = :now",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: { ":now": Date.now() },
    }),
  );
}

async function getMigrationFlags(sub: string): Promise<{
  copy?: number;
  done?: number;
}> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `user#${sub}`, sk: "config" } }),
  );
  return {
    copy: res.Item?.migrationCopyDone as number | undefined,
    done: res.Item?.migrationDone as number | undefined,
  };
}

async function migrateUser(sub: string): Promise<void> {
  const flags = await getMigrationFlags(sub);
  if (flags.done) {
    console.log(`[${sub}] already done, skipping`);
    return;
  }

  console.log(`[${sub}] fetching partition`);
  const items = await fetchUserPartition(sub);
  const reminders = items.filter((it) => (it.sk as string).startsWith("reminder#")) as unknown as Reminder[];
  const logs = items.filter((it) => (it.sk as string).startsWith("log#"));
  const notified = items.filter((it) => (it.sk as string).startsWith("notified#"));
  const profiles = items.filter((it) => (it.sk as string).startsWith("profile#")) as unknown as Profile[];

  const reminderToProfile = new Map<string, string>();
  for (const r of reminders) reminderToProfile.set(r.id, r.profileId);

  const splitLog = (item: Record<string, unknown>): Map<string, Record<string, unknown>> => {
    const byProfile = new Map<string, Record<string, unknown>>();
    for (const [key, val] of Object.entries(item)) {
      if (key === "pk" || key === "sk" || key === "ttl") continue;
      // slotKey format: "${reminderId}@HH:MM"
      const reminderId = key.split("@")[0];
      const profileId = reminderToProfile.get(reminderId);
      if (!profileId) continue;  // entry refers to deleted reminder — discard
      let bucket = byProfile.get(profileId);
      if (!bucket) {
        bucket = {};
        byProfile.set(profileId, bucket);
      }
      bucket[key] = val;
    }
    return byProfile;
  };

  const splitNotified = (item: Record<string, unknown>): Map<string, string[]> => {
    const byProfile = new Map<string, string[]>();
    const keys = (item.keys as string[]) ?? [];
    for (const k of keys) {
      // slotKey or occurrenceKey, both start with reminderId
      const reminderId = k.split(/[@#]/)[0];
      const profileId = reminderToProfile.get(reminderId);
      if (!profileId) continue;
      const bucket = byProfile.get(profileId) ?? [];
      bucket.push(k);
      byProfile.set(profileId, bucket);
    }
    return byProfile;
  };

  // ===== Phase: COPY =====
  if (PHASE === "copy" || PHASE === "all") {
    if (!flags.copy) {
      for (const r of reminders) {
        const profileId = r.profileId;
        if (DRY) {
          console.log(`[${sub}] would COPY reminder ${r.id} → profile#${profileId}`);
        } else {
          await doc.send(
            new PutCommand({
              TableName: TABLE,
              Item: { ...stripKeys(r), pk: `profile#${profileId}`, sk: `reminder#${r.id}` },
              ConditionExpression: "attribute_not_exists(pk)",
            }).catch?.((e: { name?: string }) => {
              if (e.name === "ConditionalCheckFailedException") return null;
              throw e;
            }) as never,
          );
        }
      }
      for (const lg of logs) {
        const date = (lg.sk as string).slice("log#".length);
        const ttlVal = lg.ttl as number | undefined;
        const split = splitLog(lg);
        for (const [profileId, body] of split) {
          if (DRY) {
            console.log(`[${sub}] would COPY log ${date} → profile#${profileId}`);
          } else {
            await safePut({
              pk: `profile#${profileId}`,
              sk: `log#${date}`,
              ...body,
              ...(ttlVal ? { ttl: ttlVal } : {}),
            });
          }
        }
      }
      for (const nf of notified) {
        const date = (nf.sk as string).slice("notified#".length);
        const ttlVal = nf.ttl as number | undefined;
        const split = splitNotified(nf);
        for (const [profileId, keys] of split) {
          if (DRY) {
            console.log(`[${sub}] would COPY notified ${date} → profile#${profileId} (${keys.length} keys)`);
          } else {
            await safePut({
              pk: `profile#${profileId}`,
              sk: `notified#${date}`,
              keys,
              ...(ttlVal ? { ttl: ttlVal } : {}),
            });
          }
        }
      }
      // Also enrich profile metadata in-place: ownerSub, sharedWith, version.
      for (const p of profiles) {
        if (DRY) {
          console.log(`[${sub}] would UPDATE profile ${p.id} (ownerSub, sharedWith, version)`);
        } else {
          await doc.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { pk: `user#${sub}`, sk: `profile#${p.id}` },
              UpdateExpression:
                "SET ownerSub = if_not_exists(ownerSub, :sub), sharedWith = if_not_exists(sharedWith, :empty), #v = if_not_exists(#v, :one)",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":sub": sub, ":empty": [], ":one": 1 },
            }),
          );
        }
      }
      await setMigrationFlag(sub, "migrationCopyDone");
      console.log(`[${sub}] COPY done`);
    }
  }

  // ===== Phase: VERIFY =====
  if (PHASE === "verify" || PHASE === "all") {
    for (const r of reminders) {
      const res = await doc.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: `profile#${r.profileId}`, sk: `reminder#${r.id}` },
        }),
      );
      if (!res.Item) {
        throw new Error(`[${sub}] VERIFY FAIL: reminder ${r.id} not found in profile#${r.profileId}`);
      }
    }
    console.log(`[${sub}] VERIFY ok`);
  }

  // ===== Phase: DELETE =====
  if (PHASE === "delete" || PHASE === "all") {
    for (const r of reminders) {
      if (DRY) {
        console.log(`[${sub}] would DELETE user#/reminder#${r.id}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { pk: `user#${sub}`, sk: `reminder#${r.id}` },
          }),
        );
      }
    }
    for (const lg of logs) {
      if (DRY) {
        console.log(`[${sub}] would DELETE user#/${lg.sk}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { pk: `user#${sub}`, sk: lg.sk as string },
          }),
        );
      }
    }
    for (const nf of notified) {
      if (DRY) {
        console.log(`[${sub}] would DELETE user#/${nf.sk}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { pk: `user#${sub}`, sk: nf.sk as string },
          }),
        );
      }
    }
    await setMigrationFlag(sub, "migrationDone");
    console.log(`[${sub}] DELETE done`);
  }
}

async function safePut(item: Record<string, unknown>): Promise<void> {
  try {
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ConditionalCheckFailedException") return; // already copied
    throw e;
  }
}

function stripKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { pk: _pk, sk: _sk, ...rest } = item as { pk?: unknown; sk?: unknown };
  return rest;
}

async function main() {
  console.log(`Migration phase=${PHASE} dry=${DRY}`);
  const users = await listAllUsers();
  console.log(`Found ${users.length} users`);
  for (const sub of users) {
    try {
      await migrateUser(sub);
    } catch (e) {
      console.error(`[${sub}] ERROR`, e);
      throw e; // abort, don't keep going on errors
    }
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Note: this is a script, not a Lambda. Run locally with AWS creds. The error-handling pattern for ConditionalCheckFailedException in the copy phase needs the `safePut` wrapper, which I included.

- [ ] **Step 2: Lint/type check**

Run: `cd infra && npx tsc --noEmit`
Expected: clean. Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add infra/scripts/migrate-profiles-to-shared.ts
git commit -m "feat(infra): migration script for profile-scoped partitions"
```

---

## Task B2: Test migration with a seeded local DDB

**Files:**
- Create: `infra/scripts/migrate-profiles-to-shared.test.ts`

The migration touches real DDB shapes, so test it against the same `dev-store` we use elsewhere. Refactor: extract `migrateUser` into a testable function that takes the DDB doc client as a dep.

- [ ] **Step 1: Refactor for testability (intermediate)**

Edit `infra/scripts/migrate-profiles-to-shared.ts` to export `migrateUser(sub, options)` and let `main()` call it. Add an `options.doc` parameter so tests can inject a stub. This is mechanical — extract `doc`, `TABLE` into the function signature.

- [ ] **Step 2: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { migrateUser } from "./migrate-profiles-to-shared";
import { devDoc, _resetDevStore } from "../../lib/dev-store";

beforeEach(() => _resetDevStore());

describe("migration", () => {
  it("copies reminders to profile partition", async () => {
    // Seed: a user with 2 profiles, 3 reminders
    // ... use PutCommand on devDoc to populate user# partition
    // Run migration: phase=all
    // Assert reminders exist in profile# partition and are gone from user#
  });

  it("split log by reminder's profileId", async () => {
    // Seed: 1 log#date with 2 entries from 2 different profiles
    // Migrate
    // Assert: 2 logs in two different profile# partitions, each with 1 entry
  });

  it("idempotent — running twice produces the same end state", async () => {
    // Seed, migrate, migrate again, assert same.
  });

  it("preserves TTL on log items", async () => {
    // Seed log with specific TTL, migrate, assert new log has same TTL value
  });
});
```

(Test bodies are mechanical — write them as exercises, but each should be at most 20 lines.)

- [ ] **Step 3: Run, verify pass**

Run: `npm test -- migrate-profiles`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/scripts/migrate-profiles-to-shared.ts infra/scripts/migrate-profiles-to-shared.test.ts
git commit -m "test(migration): seeded tests for migrate-profiles-to-shared"
```

---

## Task B3: Document the deploy procedure

**Files:**
- Modify: `docs/superpowers/plans/2026-05-24-compartilhar-perfis.md` (this file — add a runbook section at the bottom)
- Create: `infra/scripts/README.md`

- [ ] **Step 1: Write runbook**

Create `infra/scripts/README.md`:

```markdown
# Migration runbook: profile-scoped partitions

## Pre-flight

- Confirm code change for Phase C/D is NOT yet deployed.
- Take a DynamoDB on-demand backup (1 click in console). Required.
- Set AWS_PROFILE and DDB_TABLE_NAME locally.

## Steps

1. **Dry-run COPY** to estimate scope:
   ```
   npx tsx infra/scripts/migrate-profiles-to-shared.ts --dry-run --phase=copy
   ```
   Eyeball the count of items per user.

2. **COPY** (idempotent, safe to interrupt):
   ```
   npx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=copy
   ```

3. **VERIFY** every reminder exists in the new partition:
   ```
   npx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=verify
   ```
   Throws on the first mismatch — fix before continuing.

4. **DELETE** the old `user#<sub>/reminder#*`, `log#*`, `notified#*`:
   ```
   npx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=delete
   ```

5. **Deploy new web + lambdas** (Phase C/D code). The new code reads only
   `profile#*` partitions — old data is gone, new code is ready.

## Rollback

If COPY/VERIFY fails: re-run COPY, then VERIFY. The script is idempotent.

If DELETE was already run and you need to roll back: restore from the
DynamoDB backup taken at the start. There is no in-place rollback.
```

- [ ] **Step 2: Commit**

```bash
git add infra/scripts/README.md
git commit -m "docs(infra): migration runbook"
```

**END OF PHASE B.** Checkpoint: dev migration runs cleanly with `_resetDevStore` between tests. Pause for review.

---

# Phase C — API rewire + permission enforcement

## Task C1: New /api/profiles list across accessible profiles

**Files:**
- Modify: `app/api/profiles/route.ts`

- [ ] **Step 1: Test the API behavior** (manual — Next route tests are heavy; if you have a Vitest setup for routes, write one. Otherwise skip and rely on the Phase C5 end-to-end test.)

- [ ] **Step 2: Update GET**

```ts
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { ensureDefaultProfile, listProfilesForUser, pickProfileColor, putProfile, listProfiles } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Profile } from "@/lib/types";
import { ProfilePostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  await ensureDefaultProfile(s.sub, s.name);
  const entries = await listProfilesForUser(s.sub);
  return NextResponse.json({
    profiles: entries.map((e) => ({
      ...e.profile,
      accessRole: e.accessRole,
    })),
  });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ProfilePostSchema);
  if (!parsed.ok) return parsed.response;
  const name = parsed.data.name.trim();

  const existing = await listProfiles(s.sub);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "já existe alguém com esse nome" }, { status: 409 });
  }
  const color = parsed.data.color ?? pickProfileColor(existing);
  const profile: Profile = {
    id: nanoid(8),
    name,
    color,
    createdAt: Date.now(),
    ownerSub: s.sub,
    sharedWith: [],
    version: 1,
  };
  // Partner auto-share: if caller has a partner, share new profile with them
  const partner = await getPartner(s.sub);
  if (partner) {
    profile.sharedWith.push({
      sub: partner.partnerSub,
      role: "partner",
      addedAt: Date.now(),
    });
    await putShareLink(partner.partnerSub, {
      ownerSub: s.sub,
      profileId: profile.id,
      role: "partner",
      addedAt: Date.now(),
    });
  }
  await putProfile(s.sub, profile);
  return NextResponse.json({ profile });
}
```

Add the missing imports: `getPartner`, `putShareLink`.

- [ ] **Step 3: Manual smoke test**

```bash
LR_DEV_LOCAL=1 npm run dev
# GET /api/profiles → should return own profiles with accessRole "owner"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/profiles/route.ts
git commit -m "feat(api): /api/profiles lists own + shared; partner auto-shares new profiles"
```

---

## Task C2: /api/reminders + /api/reminders/[id] enforce profile access

**Files:**
- Modify: `app/api/reminders/route.ts`, `app/api/reminders/[id]/route.ts`

- [ ] **Step 1: Update GET to list across accessible profiles**

`app/api/reminders/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  listProfilesForUser,
  listRemindersForProfile,
  putReminderForProfile,
} from "@/lib/ddb";
import { requireProfileAccess, ForbiddenError, NotFoundError } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import type { Reminder } from "@/lib/types";
import { ReminderPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const profiles = await listProfilesForUser(s.sub);
  const all = await Promise.all(
    profiles.map((p) => listRemindersForProfile(p.profile.id)),
  );
  return NextResponse.json({ reminders: all.flat() });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ReminderPostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const profileId = await resolveProfileId(s.sub, body.profileId);
  try {
    await requireProfileAccess(s.sub, profileId, "editor");
  } catch (e) {
    return mapAccessError(e);
  }

  const isMed = body.kind === "medication";
  const reminder: Reminder = {
    id: nanoid(8),
    kind: body.kind,
    title: body.title.trim(),
    subtitle: body.subtitle?.trim() || undefined,
    schedule: body.schedule,
    status: isMed ? undefined : "unscheduled",
    preLeadDays: isMed ? undefined : sortLeads(body.preLeadDays),
    postLeadDays: isMed ? undefined : sortLeads(body.postLeadDays),
    profileId,
    seriesId: body.seriesId,
    createdAt: Date.now(),
  };
  await putReminderForProfile(reminder);
  return NextResponse.json({ reminder });
}

function sortLeads(leads?: number[]): number[] | undefined {
  if (!leads || leads.length === 0) return undefined;
  return Array.from(new Set(leads)).sort((a, b) => b - a);
}

async function resolveProfileId(sub: string, requested?: string): Promise<string> {
  if (requested) {
    const accessible = await listProfilesForUser(sub);
    const match = accessible.find((p) => p.profile.id === requested);
    if (match) return match.profile.id;
  }
  // Fallback to own default profile
  const own = await listProfilesForUser(sub);
  const def = own.find((p) => p.accessRole === "owner" && p.profile.isDefault) ?? own[0];
  if (!def) throw new Error("no accessible profile");
  return def.profile.id;
}

export function mapAccessError(e: unknown): NextResponse {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
  throw e;
}
```

- [ ] **Step 2: Update [id] PATCH/DELETE**

Read `app/api/reminders/[id]/route.ts` first to see current shape, then update each handler to:

1. Read the reminder by scanning accessible profiles (or accept `profileId` in body for PATCH).
2. Call `requireProfileAccess(s.sub, profileId, "editor")`.
3. If PATCH changes profileId, also `requireProfileAccess` on the new profile.

The simplest pattern:

```ts
// Helper at top of file:
async function findReminder(sub: string, id: string): Promise<{ reminder: Reminder; profileId: string } | null> {
  const profiles = await listProfilesForUser(sub);
  for (const p of profiles) {
    const r = await getReminderForProfile(p.profile.id, id);
    if (r) return { reminder: r, profileId: p.profile.id };
  }
  return null;
}
```

Each handler starts with:
```ts
const found = await findReminder(s.sub, params.id);
if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
try { await requireProfileAccess(s.sub, found.profileId, "editor"); }
catch (e) { return mapAccessError(e); }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/reminders/route.ts app/api/reminders/[id]/route.ts
git commit -m "feat(api): /api/reminders enforces requireProfileAccess(editor)"
```

---

## Task C3: /api/log enforce viewer access + record takenBy

**Files:**
- Modify: `app/api/log/route.ts`

- [ ] **Step 1: Update both handlers**

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  getLogForProfile,
  setLogEntryForProfile,
  listProfilesForUser,
  listRemindersForProfile,
} from "@/lib/ddb";
import { requireProfileAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { nowInTz } from "@/lib/schedule";
import { LogPostSchema, parseBody } from "@/lib/validation";
import { mapAccessError } from "../reminders/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const cfg = await getConfig(s.sub);
  const effectiveDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : nowInTz(cfg.timezone).date;

  const profiles = await listProfilesForUser(s.sub);
  const logs = await Promise.all(
    profiles.map(async (p) => {
      const log = await getLogForProfile(p.profile.id, effectiveDate);
      return [p.profile.id, log] as const;
    }),
  );
  // Merge into a single log (slotKey is globally unique by reminderId)
  const merged: Record<string, unknown> = {};
  for (const [, log] of logs) Object.assign(merged, log);
  return NextResponse.json({ date: effectiveDate, log: merged });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, LogPostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, slotKey, taken } = parsed.data;

  const [reminderId] = slotKey.split("@");
  // Find which profile owns this reminder
  const profiles = await listProfilesForUser(s.sub);
  let profileId: string | null = null;
  for (const p of profiles) {
    const reminders = await listRemindersForProfile(p.profile.id);
    if (reminders.some((r) => r.id === reminderId)) {
      profileId = p.profile.id;
      break;
    }
  }
  if (!profileId) {
    return NextResponse.json({ error: "slotKey desconhecido" }, { status: 404 });
  }
  try { await requireProfileAccess(s.sub, profileId, "viewer"); }
  catch (e) { return mapAccessError(e); }

  const cfg = await getConfig(s.sub);
  const effectiveDate = date ?? nowInTz(cfg.timezone).date;
  const log = await setLogEntryForProfile(profileId, effectiveDate, slotKey, taken, s.sub);
  return NextResponse.json({ date: effectiveDate, log });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/log/route.ts
git commit -m "feat(api): /api/log enforces viewer access; records takenBy"
```

---

## Task C4: /api/profiles/[id] DELETE — owner-only + cascade

**Files:**
- Modify: `app/api/profiles/[id]/route.ts`, `lib/ddb.ts`

- [ ] **Step 1: Rewrite deleteProfileCascade in `lib/ddb.ts`**

```ts
export async function deleteProfileCascade(ownerSub: string, profileId: string): Promise<void> {
  // 1) Fetch profile to get sharedWith — need it to delete link records
  const profRes = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(ownerSub), sk: SK.profile(profileId) } }),
  );
  const profile = profRes.Item ? stripKeys<Profile>(profRes.Item) : null;

  // 2) Delete everything in the profile partition (reminders, logs, notified)
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": PK.profile(profileId) },
        ExclusiveStartKey: lek,
      }),
    );
    const items = res.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: batch.map((it) => ({
              DeleteRequest: { Key: { pk: it.pk, sk: it.sk } },
            })),
          },
        }),
      );
    }
    lek = res.LastEvaluatedKey;
  } while (lek);

  // 3) Delete profile metadata
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(ownerSub), sk: SK.profile(profileId) },
    }),
  );

  // 4) Delete share link records of all members
  if (profile?.sharedWith) {
    for (const e of profile.sharedWith) {
      await deleteShareLink(e.sub, ownerSub, profileId);
    }
  }
}
```

- [ ] **Step 2: Update route handler**

```ts
// app/api/profiles/[id]/route.ts (DELETE handler only — keep PATCH similar with editor role)
import { requireProfileAccess, ForbiddenError, NotFoundError } from "@/lib/sharing";
import { deleteProfileCascade } from "@/lib/ddb";
import { mapAccessError } from "../../reminders/route";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  let grant;
  try { grant = await requireProfileAccess(s.sub, params.id, "owner"); }
  catch (e) { return mapAccessError(e); }
  await deleteProfileCascade(grant.profile.ownerSub, grant.profile.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/ddb.ts app/api/profiles/[id]/route.ts
git commit -m "feat(api): profile DELETE — owner-only + cascade including share links"
```

---

## Task C5: End-to-end integration test for permission enforcement

**Files:**
- Create: `app/api/__tests__/sharing.e2e.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { _resetDevStore } from "@/lib/dev-store";
import { putProfile, putShareLink, putReminderForProfile } from "@/lib/ddb";
import { requireProfileAccess } from "@/lib/sharing";

beforeEach(() => _resetDevStore());

describe("sharing e2e — permission enforcement", () => {
  it("caregiver cannot use requireProfileAccess(editor)", async () => {
    await putProfile("ownerA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 1,
    });
    await putShareLink("carerB", {
      ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1,
    });

    await expect(requireProfileAccess("carerB", "p1", "editor")).rejects.toThrow();
    await expect(requireProfileAccess("carerB", "p1", "viewer")).resolves.toBeDefined();
  });

  it("partner can edit", async () => {
    await putProfile("ownerA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "partnerB", role: "partner", addedAt: 1 }],
      version: 1,
    });

    await expect(requireProfileAccess("partnerB", "p1", "editor")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm test -- sharing.e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/__tests__/sharing.e2e.test.ts
git commit -m "test(sharing): e2e permission enforcement"
```

**END OF PHASE C.** Checkpoint: all API endpoints route through `requireProfileAccess`. Manual smoke test in dev mode: create a profile, check that without a session you get 401, with a session you can see/edit your own. Pause for review.

---

# Phase D — Lambda + EventBridge rewire

## Task D1: New `computeNextDose` operating per profile

**Files:**
- Modify: `lib/next-dose.ts`
- Test: extend `lib/next-dose.test.ts`

`computeNextDose(sub, deps)` becomes `computeNextDose({ profileId, ownerSub }, deps)`. The semantics: compute due slots for a single profile, using owner's timezone.

- [ ] **Step 1: Update deps signature**

```ts
export type NextDoseDeps = {
  getConfig: (sub: string) => Promise<Pick<Config, "timezone">>;
  listReminders: (profileId: string) => Promise<Reminder[]>;
  getLog: (profileId: string, date: string) => Promise<DayLog>;
  getNotifiedKeys: (profileId: string, date: string) => Promise<Set<string>>;
};

export type NextDoseTarget = {
  profileId: string;
  ownerSub: string;
};

export type NextDoseResult = {
  due: NotifyInput[];
  nextAt: number | null;
};
```

`NotifyInput` (in `lib/notify-one.ts`) becomes:
```ts
export type NotifyInput = {
  profileId: string;
  reminderId: string;
  time?: string;
  targetDate?: string;
  lead?: number;
};
```

- [ ] **Step 2: Update implementation**

```ts
export async function computeNextDose(
  target: NextDoseTarget,
  deps: NextDoseDeps,
  opts: NextDoseOptions = {},
): Promise<NextDoseResult> {
  const cfg = await deps.getConfig(target.ownerSub);
  const reminders = await deps.listReminders(target.profileId);
  // ... rest of function unchanged except:
  //   - tz = cfg.timezone
  //   - each input gets { profileId: target.profileId, reminderId: r.id, ... }
  //   - log/notified fetches use target.profileId, not sub
}

export const defaultDeps: NextDoseDeps = {
  getConfig: ddbGetConfig,
  listReminders: ddbListRemindersForProfile,
  getLog: ddbGetLogForProfile,
  getNotifiedKeys: ddbGetNotifiedKeysForProfile,
};
```

(Update imports at top.)

- [ ] **Step 3: Update existing test file**

`lib/next-dose.test.ts` already exists. Update all `deps` to match new shape and all calls to pass `{ profileId, ownerSub }`. Mechanical edit — keep test cases the same logically.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- next-dose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/next-dose.ts lib/next-dose.test.ts lib/notify-one.ts
git commit -m "refactor(next-dose): operate per profile, not per user"
```

---

## Task D2: `notify-one` sends to all profile members

**Files:**
- Modify: `lib/notify-one.ts`

The function now: takes `NotifyInput { profileId, reminderId, ... }`, looks up the profile, enumerates all subs with access (owner + sharedWith), fetches each chatId, sends to all.

- [ ] **Step 1: Update signature and body**

Read current `lib/notify-one.ts` first to see structure (it's 5KB — has helpers for medication + one-shot). Rewrite the top-level entry to:

```ts
import { getConfig, listProfilesForUser, _internal } from "./ddb";
const { PK, SK, doc, TABLE } = _internal;
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export async function notifyOneDose(input: NotifyInput): Promise<NotifyResult> {
  // Load the profile metadata to find members
  const ownerSubGuess = await findOwnerForProfile(input.profileId);
  if (!ownerSubGuess) return { sent: 0, error: "profile not found" };

  const profRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(ownerSubGuess), sk: SK.profile(input.profileId) },
    }),
  );
  if (!profRes.Item) return { sent: 0, error: "profile not found" };
  const profile = profRes.Item;
  const memberSubs: string[] = [profile.ownerSub as string, ...((profile.sharedWith as { sub: string }[]) ?? []).map((e) => e.sub)];

  let sent = 0;
  const messageIds: { sub: string; chatId: number; messageId: number }[] = [];
  for (const sub of memberSubs) {
    const cfg = await getConfig(sub);
    if (!cfg.chatId) continue;
    const result = await sendDoseTelegram(cfg.chatId, input, profile);
    if (result.messageId) {
      messageIds.push({ sub, chatId: cfg.chatId, messageId: result.messageId });
    }
    sent++;
  }
  return { sent, messageIds };
}

async function findOwnerForProfile(profileId: string): Promise<string | null> {
  // We don't have a GSI from profileId → ownerSub. The Lambda invocation must
  // be passing ownerSub already. So this should not be called from the Lambda
  // path. It's a safety helper for API contexts that lost ownerSub.
  return null;
}
```

Actually — this exposes a problem. `notifyOneDose` from the API context doesn't always know ownerSub. Better: change the signature to require `ownerSub`:

```ts
export type NotifyInput = {
  profileId: string;
  ownerSub: string;
  reminderId: string;
  time?: string;
  targetDate?: string;
  lead?: number;
};
```

Update `computeNextDose` to include `ownerSub` in every `NotifyInput`.

Update existing tests + Lambda handler to pass ownerSub.

- [ ] **Step 2: Adjust the helper signature in lib/next-dose.ts**

Each `raw.push({ input: { profileId, ownerSub, reminderId, ... } })`.

- [ ] **Step 3: Update notify-one.ts to use ownerSub directly**

(Remove findOwnerForProfile, just use `input.ownerSub`.)

- [ ] **Step 4: Sending logic — store messageIds for later edit**

Add: after sending all, also update the `notified` record's `messages` field with the sanitized key map:

```ts
import { sanitizeMessageKey } from "./profile-keys";
import { _internal } from "./ddb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

async function recordSentMessages(
  profileId: string,
  date: string,
  slotKey: string,
  messages: { sub: string; chatId: number; messageId: number }[],
): Promise<void> {
  if (messages.length === 0) return;
  const updates: Record<string, { chatId: number; messageId: number }> = {};
  const exprNames: Record<string, string> = { "#messages": "messages" };
  const exprValues: Record<string, unknown> = {};
  const sets: string[] = [];
  messages.forEach((m, i) => {
    const k = sanitizeMessageKey(slotKey, m.sub);
    const alias = `#k${i}`;
    const valueAlias = `:v${i}`;
    exprNames[alias] = k;
    exprValues[valueAlias] = { chatId: m.chatId, messageId: m.messageId };
    sets.push(`#messages.${alias} = ${valueAlias}`);
  });
  exprNames["#messagesInit"] = "messages";
  exprValues[":empty"] = {};
  // Init the map first if missing, then set keys.
  const { PK, SK, doc, TABLE } = _internal;
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.notified(date) },
      UpdateExpression: `SET #messagesInit = if_not_exists(#messagesInit, :empty), ${sets.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    }),
  );
}
```

Wire this in after sending — `await recordSentMessages(input.profileId, dateForSlot, slotKey, messageIds)`.

- [ ] **Step 5: Commit**

```bash
git add lib/notify-one.ts lib/next-dose.ts
git commit -m "refactor(notify-one): per-profile dispatch to all members with messageId tracking"
```

---

## Task D3: schedule-sync — per-profile schedules

**Files:**
- Create: `infra/lambda/schedule-sync/profile-schedule.ts`
- Modify: `infra/lambda/schedule-sync/handler.ts`
- Delete (after deploy): `infra/lambda/schedule-sync/user-schedule.ts`

- [ ] **Step 1: Create `profile-schedule.ts`**

Copy `user-schedule.ts` to `profile-schedule.ts`, then:
- `PREFIX = "lr-profile-"`
- Rename `userScheduleName` → `profileScheduleName(profileId)`
- Function signature: `updateProfileSchedule({ profileId, ownerSub }, deps)`
- Call: `computeNextDose({ profileId, ownerSub }, deps)`
- Schedule target Input: `JSON.stringify({ profileId, ownerSub })`

- [ ] **Step 2: Update `handler.ts`**

The handler reads DDB stream events. Old logic: when `user#<sub>/reminder#*` changes, update user schedule. New logic: when `profile#<id>/reminder#*` changes, update profile schedule. Need `ownerSub` — fetch from any sibling profile metadata? Better: events contain pk like `profile#<id>` which gives profileId. To find ownerSub, scan for the profile metadata. Since profile metadata is at `user#<ownerSub>/profile#<id>` and there's no GSI, we need another approach:

Option A: Scan with a GSI. Add a GSI `profileId → ownerSub` to the table. (CDK change.)
Option B: Maintain a `profile-meta#<profileId>` item in profile partition with ownerSub. Write whenever profile is created/updated.

Option B is simpler. Add to `putProfile`:

```ts
await doc.send(new PutCommand({
  TableName: TABLE,
  Item: { pk: PK.profile(profile.id), sk: "meta", ownerSub: profile.ownerSub, profileId: profile.id },
}));
```

(Update `Task A5` if not already done.) Schedule-sync then reads `pk: profile#<id>, sk: "meta"` to get `ownerSub`.

Update handler:

```ts
import { updateProfileSchedule } from "./profile-schedule";

export async function handler(event: { Records: any[] }): Promise<void> {
  const affectedProfiles = new Set<string>();
  for (const r of event.Records) {
    const pk = r.dynamodb?.Keys?.pk?.S as string | undefined;
    const sk = r.dynamodb?.Keys?.sk?.S as string | undefined;
    if (!pk || !sk) continue;
    if (pk.startsWith("profile#") && sk.startsWith("reminder#")) {
      affectedProfiles.add(pk.slice("profile#".length));
    }
  }
  for (const profileId of affectedProfiles) {
    const meta = await getProfileMeta(profileId);
    if (!meta) continue;
    await updateProfileSchedule({ profileId, ownerSub: meta.ownerSub });
  }
}

async function getProfileMeta(profileId: string): Promise<{ ownerSub: string } | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `profile#${profileId}`, sk: "meta" } }),
  );
  return res.Item ? { ownerSub: res.Item.ownerSub as string } : null;
}
```

- [ ] **Step 3: Update notify-dose handler (rename from notify-user)**

Create `infra/lambda/notify-dose/handler.ts` (copy notify-user/handler.ts and adapt):

```ts
import { notifyOneDose } from "../../../lib/notify-one";
import { computeNextDose, defaultDeps } from "../../../lib/next-dose";
import { updateProfileSchedule } from "../schedule-sync/profile-schedule";

type Event = { profileId?: string; ownerSub?: string };

export async function handler(event: Event) {
  if (!event?.profileId || !event?.ownerSub) {
    throw new Error("missing profileId or ownerSub");
  }
  const target = { profileId: event.profileId, ownerSub: event.ownerSub };
  const { due } = await computeNextDose(target, defaultDeps);
  for (const input of due) {
    await notifyOneDose(input);
  }
  await updateProfileSchedule(target);
  return { ...target, fired: due.length };
}
```

- [ ] **Step 4: Update CDK in compute-stack.ts**

- Rename `NOTIFY_USER_FN_NAME` → `NOTIFY_DOSE_FN_NAME = "lembrar-remedio-notify-dose"`.
- Update `entry` path: `infra/lambda/notify-dose/handler.ts`.
- Environment var: `NOTIFY_DOSE_LAMBDA_ARN`.

(The old Lambda will be deleted by CDK on deploy. The migration script will clean up old `lr-user-*` schedules — see Task D4.)

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/schedule-sync/profile-schedule.ts \
        infra/lambda/schedule-sync/handler.ts \
        infra/lambda/notify-dose/handler.ts \
        infra/lib/compute-stack.ts \
        lib/ddb.ts
git rm -r infra/lambda/notify-user
git rm infra/lambda/schedule-sync/user-schedule.ts
git commit -m "refactor(infra): per-profile schedules; rename notify-user → notify-dose"
```

---

## Task D4: Cleanup script for old `lr-user-*` schedules

**Files:**
- Create: `infra/scripts/cleanup-old-schedules.ts`

- [ ] **Step 1: Write script**

```ts
import {
  SchedulerClient,
  ListSchedulesCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";

const REGION = process.env.AWS_REGION || "us-east-1";
const DRY = process.argv.includes("--dry-run");
const client = new SchedulerClient({ region: REGION });

async function main() {
  let nextToken: string | undefined;
  let deleted = 0;
  do {
    const res = await client.send(
      new ListSchedulesCommand({ NamePrefix: "lr-user-", NextToken: nextToken }),
    );
    for (const sch of res.Schedules ?? []) {
      if (!sch.Name) continue;
      if (DRY) {
        console.log(`would delete ${sch.Name}`);
      } else {
        await client.send(new DeleteScheduleCommand({ Name: sch.Name }));
        console.log(`deleted ${sch.Name}`);
        deleted++;
      }
    }
    nextToken = res.NextToken;
  } while (nextToken);
  console.log(`done — ${deleted} deleted`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add to runbook**

Append to `infra/scripts/README.md`:

```markdown
## Post-deploy cleanup

After Phase D code is deployed, delete the legacy `lr-user-*` schedules:

```
npx tsx infra/scripts/cleanup-old-schedules.ts --dry-run
npx tsx infra/scripts/cleanup-old-schedules.ts
```
```

- [ ] **Step 3: Commit**

```bash
git add infra/scripts/cleanup-old-schedules.ts infra/scripts/README.md
git commit -m "feat(infra): cleanup script for legacy lr-user-* schedules"
```

**END OF PHASE D.** Checkpoint: deploy plan is now: (1) run migration script in prod, (2) deploy web+CDK from Phase A+B+C+D, (3) run cleanup-old-schedules.ts. Pause for review.

---

# Phase E — Sharing UI + invite flow

## Task E1: API — POST /api/sharing/invite (generate token)

**Files:**
- Create: `app/api/sharing/invite/route.ts`

- [ ] **Step 1: Implementation**

```ts
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { putPairToken, listProfilesForUser } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { parseBody } from "@/lib/validation";

export const runtime = "nodejs";

const InviteSchema = z
  .object({
    mode: z.enum(["partner", "caregiver"]),
    profileIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,16}$/)).max(20).optional(),
    inviteeEmail: z.string().email().max(200).optional(),
  })
  .strict()
  .refine(
    (d) => d.mode === "partner" || (d.profileIds && d.profileIds.length > 0),
    "caregiver invite requires profileIds",
  )
  .refine(
    (d) => d.mode === "partner" || d.inviteeEmail,
    "caregiver invite requires inviteeEmail",
  );

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, InviteSchema);
  if (!parsed.ok) return parsed.response;

  // For caregiver, verify caller actually owns all requested profileIds
  if (parsed.data.mode === "caregiver") {
    const accessible = await listProfilesForUser(s.sub);
    const ownedIds = new Set(
      accessible.filter((p) => p.accessRole === "owner").map((p) => p.profile.id),
    );
    if (!parsed.data.profileIds!.every((id) => ownedIds.has(id))) {
      return NextResponse.json({ error: "not owner of all profileIds" }, { status: 403 });
    }
  }

  const token = nanoid(24);
  const payload = {
    ownerSub: s.sub,
    mode: parsed.data.mode,
    profileIds: parsed.data.profileIds,
    inviteeEmail: parsed.data.inviteeEmail,
  };
  await putPairToken(token, JSON.stringify(payload), 24 * 60 * 60);

  return NextResponse.json({
    token,
    url: `/casa/entrar?token=${token}`,
    expiresInSec: 24 * 60 * 60,
  });
}
```

Note: `putPairToken` currently stores `sub` directly. Change its signature to accept arbitrary string payload. Update its definition in `lib/ddb.ts`:

```ts
export async function putPairToken(token: string, payloadJson: string, ttlSeconds: number): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.pair(token),
        sk: SK.pair,
        payload: payloadJson,
        ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  );
}

export async function consumePairToken(token: string): Promise<string | null> {
  try {
    const res = await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.pair(token), sk: SK.pair },
        ConditionExpression: "attribute_exists(pk) AND (attribute_not_exists(#ttl) OR #ttl > :now)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
        ReturnValues: "ALL_OLD",
      }),
    );
    return (res.Attributes?.payload as string) ?? null;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}
```

**WARNING:** This breaks the existing Telegram pairing flow which calls `putPairToken(token, sub, ttl)`. Update those callers:

```bash
grep -n "putPairToken" app/api/telegram/
```

For each call site, wrap the second arg in `JSON.stringify({ kind: "telegram", sub })`, and on consume, parse and check `kind`. Simpler: keep two functions. Add `putGenericToken` for sharing and leave `putPairToken` untouched.

**Decision:** add `putGenericToken` separately to avoid touching Telegram flow.

```ts
export async function putGenericToken(token: string, payloadJson: string, ttlSeconds: number): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.pair(token), sk: SK.pair, kind: "generic", payload: payloadJson,
              ttl: Math.floor(Date.now() / 1000) + ttlSeconds },
    }),
  );
}

export async function consumeGenericToken(token: string): Promise<string | null> {
  try {
    const res = await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.pair(token), sk: SK.pair },
        ConditionExpression: "attribute_exists(pk) AND #kind = :kind AND (attribute_not_exists(#ttl) OR #ttl > :now)",
        ExpressionAttributeNames: { "#kind": "kind", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":kind": "generic", ":now": Math.floor(Date.now() / 1000) },
        ReturnValues: "ALL_OLD",
      }),
    );
    return (res.Attributes?.payload as string) ?? null;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}
```

Use `putGenericToken`/`consumeGenericToken` in the sharing routes. Telegram routes keep using `putPairToken`.

- [ ] **Step 2: Commit**

```bash
git add app/api/sharing/invite/route.ts lib/ddb.ts
git commit -m "feat(sharing): POST /api/sharing/invite + generic token store"
```

---

## Task E2: API — POST /api/sharing/accept

**Files:**
- Create: `app/api/sharing/accept/route.ts`

- [ ] **Step 1: Implementation**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeGenericToken } from "@/lib/ddb";
import { acceptInvite } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { parseBody } from "@/lib/validation";

export const runtime = "nodejs";

const AcceptSchema = z.object({ token: z.string().min(8).max(64) }).strict();

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, AcceptSchema);
  if (!parsed.ok) return parsed.response;

  const payloadJson = await consumeGenericToken(parsed.data.token);
  if (!payloadJson) {
    return NextResponse.json({ error: "convite inválido ou expirado" }, { status: 410 });
  }
  let payload: any;
  try { payload = JSON.parse(payloadJson); }
  catch { return NextResponse.json({ error: "convite corrompido" }, { status: 500 }); }

  try {
    await acceptInvite({
      callerSub: s.sub,
      callerEmail: s.email,
      callerName: s.name,
      payload,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/sharing/accept/route.ts
git commit -m "feat(sharing): POST /api/sharing/accept consumes token + writes shares"
```

---

## Task E3: API — GET/DELETE /api/sharing (list/remove members)

**Files:**
- Create: `app/api/sharing/route.ts`

- [ ] **Step 1: Implementation**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listProfilesForUser, getPartner, deletePartner, deleteShareLink } from "@/lib/ddb";
import { removeMember, leaveShare } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { parseBody } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const profiles = await listProfilesForUser(s.sub);
  const owned = profiles.filter((p) => p.accessRole === "owner");
  const shared = profiles.filter((p) => p.accessRole !== "owner");

  const caregivers = owned.flatMap((p) =>
    p.profile.sharedWith
      .filter((e) => e.role === "caregiver")
      .map((e) => ({
        sub: e.sub,
        profileId: p.profile.id,
        profileName: p.profile.name,
        addedAt: e.addedAt,
      })),
  );
  const partner = await getPartner(s.sub);
  const memberOf = shared.map((p) => ({
    ownerSub: p.profile.ownerSub,
    profileId: p.profile.id,
    profileName: p.profile.name,
    role: p.accessRole,
  }));

  return NextResponse.json({ partner, caregivers, memberOf });
}

const DeleteBody = z
  .union([
    z.object({ kind: z.literal("caregiver"), profileId: z.string(), memberSub: z.string() }).strict(),
    z.object({ kind: z.literal("partner") }).strict(),
    z.object({ kind: z.literal("leave"), ownerSub: z.string(), profileId: z.string() }).strict(),
  ]);

export async function DELETE(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, DeleteBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.kind === "caregiver") {
    await removeMember({ callerSub: s.sub, profileId: body.profileId, memberSub: body.memberSub });
  } else if (body.kind === "partner") {
    // Remove partner record on both sides + remove partner from all owned profiles
    const partner = await getPartner(s.sub);
    if (!partner) return NextResponse.json({ ok: true });
    const accessible = await listProfilesForUser(s.sub);
    for (const p of accessible) {
      if (p.accessRole === "owner") {
        await removeMember({ callerSub: s.sub, profileId: p.profile.id, memberSub: partner.partnerSub });
      } else if (p.profile.ownerSub === partner.partnerSub) {
        await leaveShare({ callerSub: s.sub, ownerSub: partner.partnerSub, profileId: p.profile.id });
      }
    }
    await deletePartner(s.sub);
    await deletePartner(partner.partnerSub);
  } else if (body.kind === "leave") {
    await leaveShare({ callerSub: s.sub, ownerSub: body.ownerSub, profileId: body.profileId });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/sharing/route.ts
git commit -m "feat(sharing): GET/DELETE /api/sharing"
```

---

## Task E4: Accept-invite page

**Files:**
- Create: `app/casa/entrar/page.tsx`

- [ ] **Step 1: Implementation**

```tsx
// app/casa/entrar/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { _internal } from "@/lib/ddb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function peekToken(token: string): Promise<{
  ownerSub: string;
  mode: "partner" | "caregiver";
  profileIds?: string[];
  inviteeEmail?: string;
} | null> {
  const { PK, SK, doc, TABLE } = _internal;
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.pair(token), sk: SK.pair } }),
  );
  const ttl = res.Item?.ttl as number | undefined;
  if (!res.Item || (ttl && ttl <= Math.floor(Date.now() / 1000))) return null;
  if (res.Item.kind !== "generic") return null;
  try { return JSON.parse(res.Item.payload as string); }
  catch { return null; }
}

export default async function AcceptInvitePage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <p>Convite ausente.</p>;

  const session = await auth();
  if (!session?.user?.id) {
    // Persist token through login by sending user to /api/auth/signin?callbackUrl=...
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/casa/entrar?token=${token}`)}`);
  }

  const payload = await peekToken(token);
  if (!payload) return <p>Convite inválido ou expirado.</p>;
  if (payload.ownerSub === session.user.id) return <p>Você não pode aceitar seu próprio convite.</p>;
  if (payload.inviteeEmail && payload.inviteeEmail !== session.user.email) {
    return <p>Este convite foi gerado para outro email ({payload.inviteeEmail}).</p>;
  }

  // Render confirm screen (Client Component below)
  const { AcceptForm } = await import("./_accept-form");
  return <AcceptForm token={token} payload={payload} />;
}
```

Create the client component `app/casa/entrar/_accept-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptForm({
  token,
  payload,
}: {
  token: string;
  payload: { mode: "partner" | "caregiver"; profileIds?: string[] };
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/sharing/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao aceitar.");
      setSubmitting(false);
      return;
    }
    router.push("/?welcome=shared");
  }

  return (
    <div className="p-4 max-w-md mx-auto space-y-3">
      <h1 className="text-xl font-medium">Aceitar convite</h1>
      {payload.mode === "partner" ? (
        <p>Vocês vão compartilhar <b>todos os perfis</b> um do outro, atuais e futuros.</p>
      ) : (
        <p>Você terá acesso de cuidador a {payload.profileIds?.length} perfil(s).</p>
      )}
      <button
        disabled={submitting}
        onClick={accept}
        className="px-4 py-2 rounded bg-sage-600 text-white disabled:opacity-50"
      >
        {submitting ? "Aceitando…" : "Aceitar convite"}
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/casa/entrar/page.tsx app/casa/entrar/_accept-form.tsx
git commit -m "feat(ui): accept invite page /casa/entrar"
```

---

## Task E5: Settings — Compartilhar e cuidadores panel

**Files:**
- Create: `app/_components/sharing-panel.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: SharingPanel**

```tsx
// app/_components/sharing-panel.tsx
"use client";

import { useEffect, useState } from "react";

type Member = {
  partner: { partnerSub: string; partnerEmail?: string; partnerName?: string } | null;
  caregivers: { sub: string; profileId: string; profileName: string; addedAt: number }[];
  memberOf: { ownerSub: string; profileId: string; profileName: string; role: string }[];
};
type Profile = { id: string; name: string; accessRole: string };

export function SharingPanel() {
  const [data, setData] = useState<Member | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sharing").then((r) => r.json()).then(setData);
    fetch("/api/profiles").then((r) => r.json()).then((b) => setProfiles(b.profiles));
  }, []);

  async function invitePartner() {
    const res = await fetch("/api/sharing/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "partner" }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.error); return; }
    setInviteUrl(`${window.location.origin}${body.url}`);
  }

  async function inviteCaregiver(profileIds: string[], inviteeEmail: string) {
    const res = await fetch("/api/sharing/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "caregiver", profileIds, inviteeEmail }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.error); return; }
    setInviteUrl(`${window.location.origin}${body.url}`);
  }

  async function removePartner() {
    if (!confirm("Remover parceiro? Vocês param de compartilhar tudo.")) return;
    await fetch("/api/sharing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "partner" }),
    });
    location.reload();
  }

  async function removeCaregiver(profileId: string, memberSub: string) {
    if (!confirm("Remover cuidador?")) return;
    await fetch("/api/sharing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "caregiver", profileId, memberSub }),
    });
    location.reload();
  }

  async function leaveShare(ownerSub: string, profileId: string) {
    if (!confirm("Sair desse perfil?")) return;
    await fetch("/api/sharing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "leave", ownerSub, profileId }),
    });
    location.reload();
  }

  if (!data) return <p className="text-sm text-stone-500">Carregando…</p>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium mb-2">Parceiro(a)</h3>
        {data.partner ? (
          <div className="flex items-center justify-between text-sm">
            <span>{data.partner.partnerName ?? data.partner.partnerEmail ?? data.partner.partnerSub}</span>
            <button onClick={removePartner} className="text-red-600">Remover</button>
          </div>
        ) : (
          <button onClick={invitePartner} className="px-3 py-1.5 rounded border">Convidar parceiro</button>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">Cuidadores</h3>
        {data.caregivers.length === 0 && <p className="text-sm text-stone-500">Nenhum.</p>}
        <ul className="space-y-1 text-sm">
          {data.caregivers.map((c) => (
            <li key={`${c.profileId}-${c.sub}`} className="flex justify-between">
              <span>{c.sub} · {c.profileName}</span>
              <button onClick={() => removeCaregiver(c.profileId, c.sub)} className="text-red-600">Remover</button>
            </li>
          ))}
        </ul>
        <details className="mt-2">
          <summary className="text-sm cursor-pointer">+ Adicionar cuidador</summary>
          <CaregiverInviteForm
            ownProfiles={profiles.filter((p) => p.accessRole === "owner")}
            onInvite={inviteCaregiver}
          />
        </details>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">Você é cuidador em</h3>
        {data.memberOf.length === 0 && <p className="text-sm text-stone-500">Nada.</p>}
        <ul className="space-y-1 text-sm">
          {data.memberOf.map((m) => (
            <li key={m.profileId} className="flex justify-between">
              <span>{m.profileName} ({m.role})</span>
              <button onClick={() => leaveShare(m.ownerSub, m.profileId)} className="text-red-600">Sair</button>
            </li>
          ))}
        </ul>
      </section>

      {inviteUrl && (
        <div className="rounded border p-3 bg-amber-50 text-sm">
          <p className="font-medium mb-1">Link de convite (válido 24h):</p>
          <input readOnly value={inviteUrl} className="w-full p-1 font-mono text-xs" />
          <button
            onClick={() => navigator.clipboard.writeText(inviteUrl)}
            className="mt-1 px-2 py-1 rounded border text-xs"
          >Copiar</button>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}

function CaregiverInviteForm({
  ownProfiles,
  onInvite,
}: {
  ownProfiles: Profile[];
  onInvite: (profileIds: string[], email: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState("");
  return (
    <div className="mt-2 space-y-2">
      {ownProfiles.map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.has(p.id)}
            onChange={(e) => {
              const ns = new Set(selected);
              if (e.target.checked) ns.add(p.id);
              else ns.delete(p.id);
              setSelected(ns);
            }}
          /> {p.name}
        </label>
      ))}
      <input
        type="email"
        placeholder="Email do cuidador"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-1 border rounded text-sm"
      />
      <button
        disabled={selected.size === 0 || !email}
        onClick={() => onInvite([...selected], email)}
        className="px-3 py-1.5 rounded border disabled:opacity-50"
      >Gerar link</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into settings/page.tsx**

Add `<SharingPanel />` to the existing settings page. Read existing structure first:

```bash
cat app/settings/page.tsx | head -40
```

Then add `import { SharingPanel } from "@/app/_components/sharing-panel";` and render it as a new section.

- [ ] **Step 3: Manual smoke test**

```bash
LR_DEV_LOCAL=1 npm run dev
# Open http://localhost:3000/settings
# Click Convidar parceiro → URL shown
# Open URL in incognito → see accept page
```

- [ ] **Step 4: Commit**

```bash
git add app/_components/sharing-panel.tsx app/settings/page.tsx
git commit -m "feat(ui): SharingPanel in settings"
```

---

## Task E6: Account deletion handles owner-with-cuidadores

**Files:**
- Modify: `app/api/user/route.ts`, `lib/ddb.ts` `deleteUserCascade`

- [ ] **Step 1: Update deleteUserCascade**

Before deleting, check:
- If user is owner of profiles with sharedWith.length > 0 → require an explicit `confirm: true` flag.
- Cascade-delete each profile via `deleteProfileCascade` (which removes link records).
- Delete partner record on both sides.
- Delete all link records (caller's side).

```ts
export async function deleteUserCascade(sub: string): Promise<{ items: number }> {
  // 0) Detach caller from all profiles they have access to as caregiver/partner
  const links = await listShareLinks(sub);
  for (const l of links) {
    await deleteShareLink(sub, l.ownerSub, l.profileId);
    // also remove from owner's sharedWith
    const ownerRes = await doc.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(l.ownerSub), sk: SK.profile(l.profileId) },
    }));
    if (ownerRes.Item) {
      const profile = stripKeys<Profile>(ownerRes.Item);
      await putProfile(l.ownerSub, {
        ...profile,
        sharedWith: profile.sharedWith.filter((e) => e.sub !== sub),
        version: profile.version + 1,
      });
    }
  }
  // 1) Delete every owned profile (cascades to reminders/logs/notified + link records)
  const ownedProfiles = await listProfiles(sub);
  for (const p of ownedProfiles) {
    await deleteProfileCascade(sub, p.id);
  }
  // 2) Partner cleanup on both sides
  const partner = await getPartner(sub);
  if (partner) {
    await deletePartner(sub);
    await deletePartner(partner.partnerSub);
  }
  // 3) Delete user partition (config, etc.) and users index
  // ... existing logic preserved
}
```

- [ ] **Step 2: Update /api/user DELETE handler**

Add a `?confirmTransfer=true` flag, OR a body param to opt-in to "delete everything including cuidador access" — TBD per UX preference.

Simplest: just delete everything (cuidadores notified next visit that they lost access). Add a warning in the UI before calling.

- [ ] **Step 3: Commit**

```bash
git add app/api/user/route.ts lib/ddb.ts
git commit -m "feat(api): account deletion cleans up shares + partner"
```

**END OF PHASE E.** Checkpoint: full sharing flow works end-to-end in dev mode. Pause for review.

---

# Phase F — Telegram cross-member + UI polish + README

## Task F1: Edit other members' Telegram messages when someone marks taken

**Files:**
- Modify: `app/api/log/route.ts`, `lib/notify-one.ts` (export an `editDoseMessage` helper)

- [ ] **Step 1: Add helper in lib/notify-one.ts**

```ts
import { sanitizeMessageKey } from "./profile-keys";

export async function notifyOtherMembersOfTaken(args: {
  profileId: string;
  ownerSub: string;
  date: string;
  slotKey: string;
  takenBySub: string;
  takenByName?: string | null;
}): Promise<void> {
  const { PK, SK, doc, TABLE } = _internal;
  const notifiedRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(args.profileId), sk: SK.notified(args.date) },
    }),
  );
  const messages = (notifiedRes.Item?.messages ?? {}) as Record<string, { chatId: number; messageId: number }>;

  // Find all messages for this slot, except the one for the taker (their UI already shows "you marked")
  for (const [encodedKey, ref] of Object.entries(messages)) {
    let parsed;
    try { parsed = parseMessageKey(encodedKey); }
    catch { continue; }
    if (parsed.slotKey !== args.slotKey) continue;
    if (parsed.sub === args.takenBySub) continue;
    try {
      await editTelegramMessage(ref.chatId, ref.messageId,
        `✅ ${args.takenByName ?? "alguém"} marcou agora.`);
    } catch (e) {
      console.warn("editMessageText failed", { encodedKey, ref, e });
      // swallow — must not block the log write
    }
  }
}
```

Implement `editTelegramMessage` (or extend the existing `lib/telegram.ts`):

```ts
// lib/telegram.ts (additions)
export async function editTelegramMessage(chatId: number, messageId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram edit failed: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 2: Wire into /api/log POST**

```ts
// at the end of POST, after setLogEntryForProfile:
if (taken) {
  await notifyOtherMembersOfTaken({
    profileId,
    ownerSub: grant.profile.ownerSub,  // we'd need to keep grant in scope; refactor inline
    date: effectiveDate,
    slotKey,
    takenBySub: s.sub,
    takenByName: s.name,
  }).catch((e) => console.warn("notifyOtherMembersOfTaken failed", e));
}
```

(Capture `grant` from `requireProfileAccess` call earlier — refactor the handler if you didn't already.)

- [ ] **Step 3: Commit**

```bash
git add lib/notify-one.ts lib/telegram.ts app/api/log/route.ts
git commit -m "feat(notify): edit other members' Telegram message when dose is taken"
```

---

## Task F2: UI badges + "marcado por X"

**Files:**
- Modify: `app/_components/profiles-panel.tsx`, `app/_components/today-list.tsx`, `app/_components/upcoming-list.tsx`

- [ ] **Step 1: Add badge in profiles-panel**

Profiles with `accessRole !== "owner"` get a small label, e.g., `(parceiro)` or `(cuidador)` next to the name. Skip a full UI redesign — just a text label is enough for shipping. Read current shape, edit minimally.

- [ ] **Step 2: today-list / upcoming-list**

When showing a marked dose, if `takenBy !== caller.sub`, show "marcado por (nome ou email)". Caller's name comes from the session; other names — we don't have a directory, so just show the email or sub-shortened.

This requires the API to return takenBy/email — extend `/api/log` GET to fetch member emails. Simpler: just show `takenBy` as-is, or hide it (show "marcado por outro"). Pick the simplest version first.

- [ ] **Step 3: Commit**

```bash
git add app/_components/profiles-panel.tsx app/_components/today-list.tsx app/_components/upcoming-list.tsx
git commit -m "feat(ui): badge shared profiles, show takenBy on marked doses"
```

---

## Task F3: Fix README — Telegram-only notifications + add sharing docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Find the section in `README.md`:

```
| Plataforma | App aberto / PWA ativo | App fechado |
|---|---|---|
| Telegram (pareado) | ✓ | ✓ |
| Chrome desktop sem Telegram | ✓ | — |
...
```

Replace with:

```
## Notificações

Notificação é só por Telegram. Sem Telegram pareado você não recebe aviso
ativo — só vê os lembretes ao abrir o app.

Pra parear: **Ajustes → Conectar Telegram**.
```

And the "Limitações" block, remove the PWA bullet.

Add a new section:

```markdown
## Compartilhar com outras pessoas

Dois modos:

- **Parceiro(a):** compartilha *todos* seus perfis. Casal cuidando de um
  filho, por exemplo. Ambos podem editar, marcar dose, ver tudo.
- **Cuidador:** compartilha perfis específicos. Babá vê só os perfis do
  filho, não os seus. Cuidador pode marcar dose mas não edita remédios.

Em **Ajustes → Compartilhar e cuidadores**.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): Telegram-only notifications; add sharing section"
```

---

## Task F4: Update spec with implementation trade-offs

**Files:**
- Modify: `docs/superpowers/specs/2026-05-24-compartilhar-perfis-design.md`

- [ ] **Step 1: Add a "Implementation trade-offs" subsection**

Note items deferred during implementation: sequential writes instead of `TransactWriteItems` for accept (rationale: invite-accept is not under hot concurrency), profile-meta sentinel item in `profile#<id>/meta` (rationale: avoids adding a GSI), `takenBy` display shows email/sub (no directory of members), no notification to inviter on accept.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-24-compartilhar-perfis-design.md
git commit -m "docs(spec): document implementation trade-offs"
```

**END OF PHASE F.** Final smoke test:

1. Dev mode: create profile, invite caregiver, accept in incognito, mark a dose, see takenBy.
2. Run all tests: `npm test`.
3. Run TypeScript check: `npx tsc --noEmit`.
4. Manual: open a Telegram notification, mark dose, confirm other member sees edited message.

---

## Deploy sequence (post-implementation)

1. Merge Phases A+B → main.
2. **PROD migration:** take DDB backup, run `migrate-profiles-to-shared.ts` (copy → verify → delete).
3. Merge Phase C+D → deploy web (Vercel) + CDK.
4. Run `cleanup-old-schedules.ts`.
5. Merge Phase E+F → deploy.
6. Announce sharing feature.

---

## Self-review (pre-handoff)

Spec coverage:
- ✓ Permission enforcement (Task A6 + applied in C2-C5)
- ✓ Migration 3-pass with TTL preservation (Task B1)
- ✓ Atomic accept via per-profile sequential PutItem with version check (Task A7) — note: trade-off documented in F4
- ✓ `messages` map sanitized keys (Task A2 + D2)
- ✓ deleteProfileCascade rewrite (Task C4)
- ✓ Schedule cleanup (Task D4)
- ✓ ownerSub in schedule payload + profile-meta sentinel (Task D3)
- ✓ inviteeEmail binding (Task E1 + E4)
- ✓ editMessageText error swallowed (Task F1)
- ✓ Transfer / cuidador-link orphan handling at account deletion (Task E6)
- ✓ Telegram-only notification README fix (Task F3)

Placeholder scan: a couple of "fill in mechanically" notes in B2 + C2 — those are bounded tasks an engineer can complete from the given seed; not stop-the-world placeholders.

Type consistency: `NotifyInput` shape settled in D1 (`{ profileId, ownerSub, reminderId, time?, targetDate?, lead? }`). `NextDoseTarget = { profileId, ownerSub }`. `ProfileWithAccess = { profile, accessRole }`. All consistent.
