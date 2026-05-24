import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { putGenericToken, listProfilesForUser } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { parseBody } from "@/lib/validation";

export const runtime = "nodejs";

const InviteSchema = z
  .object({
    mode: z.enum(["partner", "caregiver"]),
    profileIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,16}$/))
      .max(20)
      .optional(),
    // Invites are email-bound for BOTH modes — the link only grants access to
    // the specific person it is issued for.
    inviteeEmail: z.string().email().max(200),
  })
  .strict()
  .refine(
    (d) => d.mode === "partner" || (d.profileIds && d.profileIds.length > 0),
    "caregiver invite requires profileIds",
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
  await putGenericToken(token, JSON.stringify(payload), 24 * 60 * 60);

  return NextResponse.json({
    token,
    url: `/casa/entrar?token=${token}`,
    expiresInSec: 24 * 60 * 60,
  });
}
