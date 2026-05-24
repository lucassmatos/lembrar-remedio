import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { ensureDefaultProfile, listProfiles, pickProfileColor, putProfile } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Profile } from "@/lib/types";
import { ProfilePostSchema, parseBody } from "@/lib/validation";

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
  };
  await putProfile(s.sub, profile);
  return NextResponse.json({ profile });
}
