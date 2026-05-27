import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  _internal,
  listShareLinks,
  putProfile,
  putShareLink,
  deleteShareLink,
  setPartner,
  getPartner,
  listProfiles as listOwnerProfiles,
  listProfilesForUser,
  listRemindersForProfile,
} from "./ddb";
import type { PartnerRecord, ProfileShareEntry, Profile, Reminder } from "./types";
import { NextResponse } from "next/server";

const { PK, SK, doc, TABLE } = _internal;

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── A6: requireProfileAccess ─────────────────────────────────────────────────

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
    throw new ForbiddenError(profileId);
  }
  const ownerRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(match.ownerSub), sk: SK.profile(profileId) },
    }),
  );
  if (!ownerRes.Item) {
    // Stale link record — profile was deleted
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

// ── requireHouseholdAccess ───────────────────────────────────────────────────

/**
 * Gate das listas da casa. O caller pode acessar a partição de `ownerSub` se for
 * o próprio dono OU o parceiro dele (relação 1:1 simétrica via getPartner).
 * Lança ForbiddenError (→ 403 via mapAccessError) caso contrário. Cuidador não entra.
 */
export async function requireHouseholdAccess(
  callerSub: string,
  ownerSub: string,
): Promise<void> {
  if (callerSub === ownerSub) return;
  const partner = await getPartner(callerSub);
  if (partner?.partnerSub === ownerSub) return;
  throw new ForbiddenError(ownerSub);
}

// ── A7: acceptInvite ─────────────────────────────────────────────────────────

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
  // Invites are email-bound for BOTH modes — the link only grants access to
  // the specific person it was issued for.
  if (!payload.inviteeEmail || payload.inviteeEmail !== callerEmail) {
    throw new Error("inviteeEmail mismatch");
  }
  if (payload.ownerSub === callerSub) {
    throw new Error("cannot accept own invite");
  }

  // Reject a second partner on either side — overwriting a partner record
  // would leave the previous partner with dangling access.
  if (payload.mode === "partner") {
    if (await getPartner(callerSub)) {
      throw new Error("você já tem um parceiro vinculado");
    }
    const ownerPartner = await getPartner(payload.ownerSub);
    if (ownerPartner && ownerPartner.partnerSub !== callerSub) {
      throw new Error("o dono do convite já tem um parceiro vinculado");
    }
  }

  const now = Date.now();
  // Fetch the owner's profiles once (avoid N+1 inside the loop).
  const owned = await listOwnerProfiles(payload.ownerSub);
  const profilesToShare: string[] =
    payload.mode === "partner"
      ? owned.map((p) => p.id)
      : payload.profileIds ?? [];

  if (profilesToShare.length === 0 && payload.mode === "caregiver") {
    throw new Error("no profiles to share");
  }

  for (const profileId of profilesToShare) {
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

    const callerRecord: PartnerRecord = {
      partnerSub: payload.ownerSub,
      since: now,
    };
    await setPartner(callerSub, callerRecord);

    // Partnership is a single shared household: share the invitee's own
    // profiles back to the owner too, so both partners see the full roster
    // and notifications for either side's profiles fan out to both members.
    const callerOwned = await listOwnerProfiles(callerSub);
    for (const profile of callerOwned) {
      if (!profile.sharedWith.some((e) => e.sub === payload.ownerSub)) {
        await putProfile(callerSub, {
          ...profile,
          sharedWith: [
            ...profile.sharedWith,
            { sub: payload.ownerSub, role: "partner", addedAt: now },
          ],
          version: profile.version + 1,
        });
      }
      await putShareLink(payload.ownerSub, {
        ownerSub: callerSub,
        profileId: profile.id,
        role: "partner",
        addedAt: now,
      });
    }
  }
}

// ── A8: removeMember + leaveShare ────────────────────────────────────────────

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
  // Verify the caller actually has a share link for this ownerSub+profileId.
  // Without this, any authenticated user could mutate an arbitrary profile's
  // sharedWith and delete share links by supplying client-controlled ids.
  const links = await listShareLinks(args.callerSub);
  const hasLink = links.some(
    (l) => l.ownerSub === args.ownerSub && l.profileId === args.profileId,
  );
  if (!hasLink) return; // nothing to leave
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

// ── mapAccessError ────────────────────────────────────────────────────────────

/**
 * Maps ForbiddenError → 403, NotFoundError → 404.
 * Re-throws anything else.
 */
export function mapAccessError(e: unknown): NextResponse {
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  throw e;
}

// ── findReminder ──────────────────────────────────────────────────────────────

export type ReminderWithProfile = {
  reminder: Reminder;
  profileId: string;
  ownerSub: string;
};

/**
 * Walks all accessible profiles for sub and returns the first reminder
 * matching reminderId, or null if not found.
 */
export async function findReminder(
  sub: string,
  reminderId: string,
): Promise<ReminderWithProfile | null> {
  const grants = await listProfilesForUser(sub);
  for (const grant of grants) {
    const reminders = await listRemindersForProfile(grant.profile.id);
    const found = reminders.find((r) => r.id === reminderId);
    if (found) {
      return { reminder: found, profileId: grant.profile.id, ownerSub: grant.profile.ownerSub };
    }
  }
  return null;
}
