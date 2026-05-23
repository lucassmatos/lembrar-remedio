import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { ensureDefaultProfile, listProfiles, pickProfileColor, putProfile } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { PROFILE_COLORS, type Profile, type ProfileColor } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  await ensureDefaultProfile(s.sub, s.name);
  const profiles = await listProfiles(s.sub);
  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const body = (await req.json()) as { name?: string; color?: string };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  }
  const existing = await listProfiles(s.sub);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "já existe alguém com esse nome" }, { status: 409 });
  }
  const color: ProfileColor = isProfileColor(body.color) ? body.color : pickProfileColor(existing);
  const profile: Profile = {
    id: nanoid(8),
    name: name.slice(0, 40),
    color,
    createdAt: Date.now(),
  };
  await putProfile(s.sub, profile);
  return NextResponse.json({ profile });
}

function isProfileColor(v: unknown): v is ProfileColor {
  return typeof v === "string" && (PROFILE_COLORS as readonly string[]).includes(v);
}
