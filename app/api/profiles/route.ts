import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  ensureDefaultProfile,
  listProfilesForUser,
  listProfiles,
  pickProfileColor,
  putProfile,
  putShareLink,
  getPartner,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Profile, ProfileShareEntry } from "@/lib/types";
import { ProfilePostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  await ensureDefaultProfile(s.sub, s.name);
  const grants = await listProfilesForUser(s.sub);
  const profiles = grants.map((g) => ({ ...g.profile, accessRole: g.accessRole }));
  return NextResponse.json({ profiles });
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

  // Check if caller has a partner so we can auto-add them.
  const partner = await getPartner(s.sub);

  const sharedWith: ProfileShareEntry[] = partner
    ? [{ sub: partner.partnerSub, role: "partner", addedAt: Date.now() }]
    : [];

  const profile: Profile = {
    id: nanoid(8),
    name,
    color,
    createdAt: Date.now(),
    ownerSub: s.sub,
    sharedWith,
    version: 1,
  };
  await putProfile(s.sub, profile);

  // If there's a partner, write their share-link record.
  if (partner) {
    await putShareLink(partner.partnerSub, {
      ownerSub: s.sub,
      profileId: profile.id,
      role: "partner",
      addedAt: Date.now(),
    });
  }

  return NextResponse.json({ profile });
}
