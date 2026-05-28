import { NextRequest, NextResponse } from "next/server";
import { deleteRoutineDone, getHouseRoutine, putRoutineDone } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import type { RoutineDone } from "@/lib/types";
import { parseBody, PERIOD, RoutineDonePostSchema, SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFrom(req: NextRequest): string | null {
  const o = new URL(req.url).searchParams.get("ownerSub");
  return o && SUB.test(o) ? o : null;
}

// POST — marca a rotina como feita no período. Valida que a rotina-pai existe.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id: routineId } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  const parsed = await parseBody(req, RoutineDonePostSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }

  const parent = await getHouseRoutine(ownerSub, routineId);
  if (!parent) return NextResponse.json({ error: "routine not found" }, { status: 404 });

  const done: RoutineDone = {
    routineId,
    period: parsed.data.period,
    doneBy: s.sub,
    doneAt: Date.now(),
  };
  await putRoutineDone(ownerSub, done);
  return NextResponse.json({ done });
}

// DELETE — desmarca no período (period vem na query, não no body).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id: routineId } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  const period = new URL(req.url).searchParams.get("period");
  if (!period || !PERIOD.test(period)) {
    return NextResponse.json({ error: "period inválido" }, { status: 400 });
  }

  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }

  await deleteRoutineDone(ownerSub, routineId, period);
  return NextResponse.json({ ok: true });
}
