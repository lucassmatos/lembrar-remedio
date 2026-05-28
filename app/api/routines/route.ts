import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getConfig, getRoutineDone, putHouseRoutine, routinesForHousehold } from "@/lib/ddb";
import { candidatesFor, periodFor, type RoutineOccurrence } from "@/lib/routines";
import { requireSession } from "@/lib/session";
import type { HouseRoutine } from "@/lib/types";
import { parseBody, RoutinePostSchema } from "@/lib/validation";

// Quão à frente mostrar a próxima ocorrência (quando o período atual já foi feito).
const LOOKAHEAD: Record<"monthly" | "weekly", number> = {
  monthly: 14,
  weekly: 7,
};

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

      // Próxima ocorrência pra mostrar em "Próximos":
      // - Se o período atual não tá done, mostra ele (mesmo atrasado).
      // - Senão mostra o próximo, se estiver dentro do lookahead da freq.
      let next: (RoutineOccurrence & { done: boolean }) | null = null;
      if (r.freq === "monthly" || r.freq === "weekly") {
        const { current, next: cand } = candidatesFor(r, now, tz);
        if (current && !done) {
          next = { ...current, done: false };
        } else if (cand && cand.daysAway <= LOOKAHEAD[r.freq]) {
          const doneNext = await getRoutineDone(r.ownerSub, r.id, cand.period);
          next = { ...cand, done: !!doneNext };
        }
      }

      return {
        ...r,
        currentPeriod: period,
        doneInPeriod: !!done,
        doneBy: done?.doneBy,
        next,
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
