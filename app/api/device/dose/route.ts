import { NextRequest, NextResponse } from "next/server";
import { getConfig, setLogEntryForProfile } from "@/lib/ddb";
import { requireDeviceToken } from "@/lib/session";
import { requireProfileAccess, mapAccessError, findReminder } from "@/lib/sharing";
import { nowInTz } from "@/lib/schedule";
import { LogPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marca/desmarca uma dose pelo mostrador físico. Mesma lógica do POST /api/log,
 * mas autenticado por token de device. Reusa o gate requireProfileAccess (nunca
 * confia só no token) e dispara o fan-out pros outros membros (Telegram/push).
 */
export async function POST(req: NextRequest) {
  const auth = await requireDeviceToken(req);
  if (!auth.ok) return auth.response;
  const sub = auth.sub;

  const parsed = await parseBody(req, LogPostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, slotKey, taken } = parsed.data;

  // slotKey é `${reminderId}@HH:MM` — acha qual perfil acessível tem esse lembrete.
  const [reminderId] = slotKey.split("@");
  const found = await findReminder(sub, reminderId);
  if (!found) {
    return NextResponse.json({ error: "slotKey desconhecido" }, { status: 404 });
  }
  const targetProfileId = found.profileId;

  try {
    await requireProfileAccess(sub, targetProfileId, "viewer");
  } catch (e) {
    return mapAccessError(e);
  }

  const cfg = await getConfig(sub);
  const effectiveDate = date ?? nowInTz(cfg.timezone || "America/Sao_Paulo").date;
  const log = await setLogEntryForProfile(
    targetProfileId,
    effectiveDate,
    slotKey,
    taken,
    sub,
    "mostrador",
  );
  if (taken) {
    const { notifyOtherMembersOfTaken } = await import("@/lib/notify-one");
    notifyOtherMembersOfTaken({
      profileId: targetProfileId,
      date: effectiveDate,
      slotKey,
      takenBySub: sub,
      takenByName: "mostrador",
    }).catch((e: unknown) =>
      console.warn("[device/dose] notifyOtherMembersOfTaken failed:", e),
    );
  }
  return NextResponse.json({ date: effectiveDate, log });
}
