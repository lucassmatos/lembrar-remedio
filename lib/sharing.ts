import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  _internal,
  listShareLinks,
  putProfile,
  putShareLink,
  deleteShareLink,
  setPartner,
  listProfiles as listOwnerProfiles,
} from "./ddb";
import type { PartnerRecord, ProfileShareEntry, Profile } from "./types";

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

    const callerRecord: PartnerRecord = {
      partnerSub: payload.ownerSub,
      since: now,
    };
    await setPartner(callerSub, callerRecord);
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
