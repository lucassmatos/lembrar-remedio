import { dateInTz } from "./schedule";
import type { HouseRoutine } from "./types";

/**
 * Identifica o "período corrente" da rotina pra marcar como feita uma vez por
 * período. Daily = dia (YYYY-MM-DD), weekly = semana ISO (YYYY-Www), monthly =
 * mês (YYYY-MM). Tudo no timezone do usuário.
 */
export function periodFor(routine: HouseRoutine, atMs: number, tz: string): string {
  const { date } = dateInTz(atMs, tz);
  if (routine.freq === "daily") return date;
  if (routine.freq === "monthly") return date.slice(0, 7);
  return isoWeekKey(date);
}

/**
 * Rotina é devida hoje? Daily sempre; weekly se hoje = anchor (dow); monthly
 * se hoje = anchor (dom).
 */
export function isDueOn(routine: HouseRoutine, atMs: number, tz: string): boolean {
  const { date } = dateInTz(atMs, tz);
  if (routine.freq === "daily") return true;
  if (routine.freq === "monthly") {
    const dom = parseInt(date.slice(8, 10), 10);
    return dom === routine.anchor;
  }
  if (routine.freq === "weekly") {
    const dow = dayOfWeek(date);
    return dow === routine.anchor;
  }
  return false;
}

/** Label humano da frequência ("todo dia 25", "toda terça", "todo dia"). */
export function freqLabel(r: HouseRoutine): string {
  if (r.freq === "daily") return "todo dia";
  if (r.freq === "weekly") {
    const days = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    return `toda ${days[r.anchor ?? 1]}`;
  }
  return `todo dia ${r.anchor ?? 1}`;
}

/** Hora pra mostrar na Timeline: a do usuário ou 08:00 (lembrar de manhã). */
export function timelineTime(r: HouseRoutine): string {
  return r.time ?? "08:00";
}

/** YYYY-MM-DD (date no tz) → 0..6 (dom..sáb). */
function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // Date.UTC com year/month/day (zero-based month) é determinístico, sem tz local.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** YYYY-MM-DD → YYYY-Www (ISO 8601 week). */
function isoWeekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  // ISO week: quinta-feira da mesma semana define o ano-semana.
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
