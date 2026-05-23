import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { ensureDefaultProfile, listMeds, listProfiles, putMed } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Medication } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const meds = await listMeds(s.sub);
  return NextResponse.json({ meds });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const body = (await req.json()) as Partial<Medication>;
  if (!body.name || !body.intervalHours || !body.startTime) {
    return NextResponse.json({ error: "name, intervalHours, startTime obrigatórios" }, { status: 400 });
  }
  const profileId = await resolveProfileId(s.sub, body.profileId);
  const med: Medication = {
    id: nanoid(8),
    name: body.name.trim(),
    dosage: body.dosage?.trim() || undefined,
    intervalHours: Number(body.intervalHours),
    startTime: body.startTime,
    times: body.times,
    durationMinutes: body.durationMinutes,
    profileId,
    createdAt: Date.now(),
  };
  await putMed(s.sub, med);
  return NextResponse.json({ med });
}

async function resolveProfileId(sub: string, requested?: string): Promise<string> {
  if (requested) {
    const profiles = await listProfiles(sub);
    const match = profiles.find((p) => p.id === requested);
    if (match) return match.id;
  }
  const def = await ensureDefaultProfile(sub);
  return def.id;
}
