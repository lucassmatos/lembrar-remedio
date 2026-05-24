import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listProfilesForUser,
  getPartner,
  deletePartner,
} from "@/lib/ddb";
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

const DeleteBody = z.union([
  z
    .object({
      kind: z.literal("caregiver"),
      profileId: z.string(),
      memberSub: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("partner") }).strict(),
  z
    .object({
      kind: z.literal("leave"),
      ownerSub: z.string(),
      profileId: z.string(),
    })
    .strict(),
]);

export async function DELETE(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;

  const parsed = await parseBody(req, DeleteBody);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;

  if (body.kind === "caregiver") {
    await removeMember({
      callerSub: s.sub,
      profileId: body.profileId,
      memberSub: body.memberSub,
    });
  } else if (body.kind === "partner") {
    const partner = await getPartner(s.sub);
    if (!partner) return NextResponse.json({ ok: true });

    // Remove partner from all owned profiles + leave partner's profiles
    const accessible = await listProfilesForUser(s.sub);
    for (const p of accessible) {
      if (p.accessRole === "owner") {
        // Remove partner from this owned profile (ignore if not a member)
        const isMember = p.profile.sharedWith.some((e) => e.sub === partner.partnerSub);
        if (isMember) {
          await removeMember({
            callerSub: s.sub,
            profileId: p.profile.id,
            memberSub: partner.partnerSub,
          });
        }
      } else if (p.profile.ownerSub === partner.partnerSub) {
        await leaveShare({
          callerSub: s.sub,
          ownerSub: partner.partnerSub,
          profileId: p.profile.id,
        });
      }
    }

    await deletePartner(s.sub);
    await deletePartner(partner.partnerSub);
  } else if (body.kind === "leave") {
    await leaveShare({
      callerSub: s.sub,
      ownerSub: body.ownerSub,
      profileId: body.profileId,
    });
  }

  return NextResponse.json({ ok: true });
}
