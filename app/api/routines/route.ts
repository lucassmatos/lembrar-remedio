import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getConfig, getRoutineDone, putHouseRoutine, routinesForHousehold } from "@/lib/ddb";
import { periodFor } from "@/lib/routines";
import { requireSession } from "@/lib/session";
import type { HouseRoutine } from "@/lib/types";
import { parseBody, RoutinePostSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cada rotina vem com o período corrente computado no servidor (tz-aware) e
 * se já foi feita nesse período. Um round trip serve a UI inteira.
 */
export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const tz = (await getConfig(s.sub)).timezone;
  const routines = await routinesForHousehold(s.sub);
  const now = Date.now();
  const enriched = await Promise.all(
    routines.map(async (r) => {
      const period = periodFor(r, now, tz);
      const done = await getRoutineDone(r.ownerSub, r.id, period);
      return {
        ...r,
        currentPeriod: period,
        doneInPeriod: !!done,
        doneBy: done?.doneBy,
      };
    }),
  );
  return NextResponse.json({ routines: enriched });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, RoutinePostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const routine: HouseRoutine = {
    id: nanoid(8),
    ownerSub: s.sub,
    title: body.title.trim(),
    freq: body.freq,
    ...(body.anchor != null ? { anchor: body.anchor } : {}),
    ...(body.time ? { time: body.time } : {}),
    createdAt: Date.now(),
  };
  await putHouseRoutine(s.sub, routine);
  return NextResponse.json({ routine });
}
