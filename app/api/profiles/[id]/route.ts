import { NextRequest, NextResponse } from "next/server";
import { deleteProfileCascade, listProfiles, putProfile } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { requireProfileAccess, mapAccessError } from "@/lib/sharing";
import type { Profile } from "@/lib/types";
import { ProfilePatchSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;

  let grant;
  try {
    grant = await requireProfileAccess(s.sub, id, "editor");
  } catch (e) {
    return mapAccessError(e);
  }

  const existing = grant.profile;
  const parsed = await parseBody(req, ProfilePatchSchema);
  if (!parsed.ok) return parsed.response;

  const nextName = parsed.data.name !== undefined ? parsed.data.name.trim() : existing.name;
  if (!nextName) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }

  // Dup-name check: look at all profiles owned by the profile's owner.
  const ownerProfiles = await listProfiles(existing.ownerSub);
  const dupe = ownerProfiles.find(
    (p) => p.id !== id && p.name.toLowerCase() === nextName.toLowerCase(),
  );
  if (dupe) {
    return NextResponse.json({ error: "já existe alguém com esse nome" }, { status: 409 });
  }

  const updated: Profile = {
    ...existing,
    name: nextName,
    color: parsed.data.color ?? existing.color,
    aindaMama: parsed.data.aindaMama ?? existing.aindaMama,
  };
  await putProfile(existing.ownerSub, updated);
  return NextResponse.json({ profile: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;

  let grant;
  try {
    grant = await requireProfileAccess(s.sub, id, "owner");
  } catch (e) {
    return mapAccessError(e);
  }

  const ownerProfiles = await listProfiles(grant.profile.ownerSub);
  if (ownerProfiles.length <= 1) {
    return NextResponse.json(
      { error: "não dá pra apagar a última pessoa" },
      { status: 400 },
    );
  }
  if (grant.profile.isDefault) {
    return NextResponse.json(
      { error: "marque outra pessoa como padrão antes de apagar essa" },
      { status: 400 },
    );
  }
  await deleteProfileCascade(grant.profile.ownerSub, id);
  return NextResponse.json({ ok: true });
}
