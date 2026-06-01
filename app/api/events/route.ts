import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eventsForHousehold, getConfig, putHouseEvent } from "@/lib/ddb";
import { daysBetween, nowInTz } from "@/lib/schedule";
import { requireSession } from "@/lib/session";
import type { HouseEvent } from "@/lib/types";
import { EventPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cada evento vem com daysAway computado no servidor (tz-aware). */
export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const tz = (await getConfig(s.sub)).timezone;
  const today = nowInTz(tz).date;
  const list = await eventsForHousehold(s.sub);
  const enriched = list
    .map((e) => ({ ...e, daysAway: daysBetween(today, e.date) }))
    .sort((a, b) => a.daysAway - b.daysAway);
  return NextResponse.json({ events: enriched });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, EventPostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const event: HouseEvent = {
    id: nanoid(8),
    ownerSub: s.sub,
    title: body.title.trim(),
    date: body.date,
    ...(body.time ? { time: body.time } : {}),
    createdAt: Date.now(),
  };
  await putHouseEvent(s.sub, event);
  return NextResponse.json({ event });
}
