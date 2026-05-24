import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  ensureDefaultProfile,
  findOpenNap,
  getConfig,
  listActivities,
  listOpenNaps,
  listProfiles,
  putActivity,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { dateInTz, nowInTz } from "@/lib/schedule";
import type { Activity } from "@/lib/types";
import { ActivityPostSchema, ISO_DATE, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const tz = (await getConfig(s.sub)).timezone;
  const requested = new URL(req.url).searchParams.get("date");
  if (requested && !ISO_DATE.test(requested)) {
    return NextResponse.json({ error: "date inválido (YYYY-MM-DD)" }, { status: 400 });
  }
  const date = requested || nowInTz(tz).date;

  const [activities, openNaps] = await Promise.all([
    listActivities(s.sub, date),
    listOpenNaps(s.sub, tz),
  ]);

  return NextResponse.json({ date, activities, openNaps });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ActivityPostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const tz = (await getConfig(s.sub)).timezone;
  const profileId = await resolveProfileId(s.sub, body.profileId);
  const id = nanoid(8);
  const createdAt = Date.now();

  // Iniciar soneca é idempotente: se já há uma em andamento p/ o perfil, devolve
  // ela em vez de criar uma segunda (defende double-tap / dois dispositivos).
  if (body.type === "nap" && body.startedAt === undefined) {
    const existing = await findOpenNap(s.sub, profileId, tz);
    if (existing) return NextResponse.json({ activity: existing });
  }

  let activity: Activity;
  if (body.type === "nap") {
    const startedAt = body.startedAt ?? createdAt;
    activity = {
      id,
      type: "nap",
      profileId,
      date: dateInTz(startedAt, tz).date,
      createdAt,
      startedAt,
    };
  } else {
    const at = body.at ?? createdAt;
    activity = {
      id,
      type: "feed",
      profileId,
      date: dateInTz(at, tz).date,
      createdAt,
      side: body.side,
      at,
    };
  }

  await putActivity(s.sub, activity);
  return NextResponse.json({ activity });
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
