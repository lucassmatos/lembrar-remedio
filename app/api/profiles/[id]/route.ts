import { NextRequest, NextResponse } from "next/server";
import { deleteProfileCascade, listProfiles, putProfile } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { PROFILE_COLORS, type Profile, type ProfileColor } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const profiles = await listProfiles(s.sub);
  const existing = profiles.find((p) => p.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as { name?: string; color?: string };
  const nextName = body.name !== undefined ? body.name.trim() : existing.name;
  if (!nextName) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }
  const dupe = profiles.find(
    (p) => p.id !== id && p.name.toLowerCase() === nextName.toLowerCase(),
  );
  if (dupe) {
    return NextResponse.json({ error: "já existe alguém com esse nome" }, { status: 409 });
  }
  const color: ProfileColor = isProfileColor(body.color) ? body.color : existing.color;
  const updated: Profile = { ...existing, name: nextName.slice(0, 40), color };
  await putProfile(s.sub, updated);
  return NextResponse.json({ profile: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const profiles = await listProfiles(s.sub);
  const target = profiles.find((p) => p.id === id);
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (profiles.length <= 1) {
    return NextResponse.json(
      { error: "não dá pra apagar a última pessoa" },
      { status: 400 },
    );
  }
  if (target.isDefault) {
    return NextResponse.json(
      { error: "marque outra pessoa como padrão antes de apagar essa" },
      { status: 400 },
    );
  }
  await deleteProfileCascade(s.sub, id);
  return NextResponse.json({ ok: true });
}

function isProfileColor(v: unknown): v is ProfileColor {
  return typeof v === "string" && (PROFILE_COLORS as readonly string[]).includes(v);
}
