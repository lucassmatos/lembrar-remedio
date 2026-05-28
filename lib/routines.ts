import { daysBetween, dateInTz } from "./schedule";
import type { HouseRoutine } from "./types";

/** Ocorrência candidata (data, período, distância em dias, em atraso). */
export type RoutineOccurrence = {
  date: string;
  period: string;
  daysAway: number;
  isOverdue: boolean;
};

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

/**
 * Duas candidatas pra "próxima ocorrência": o anchor do período corrente (que
 * pode estar atrasado se já passou) e o anchor do próximo período. O caller
 * (com acesso ao done state) decide qual mostrar:
 *   - se current.period não tá done → mostra current (mesmo atrasado)
 *   - se current.period tá done → mostra next, se estiver dentro do lookahead
 * Daily não tem upcoming (vive em "Rotinas de hoje" sempre).
 */
export function candidatesFor(
  routine: HouseRoutine,
  atMs: number,
  tz: string,
): { current: RoutineOccurrence | null; next: RoutineOccurrence | null } {
  if (routine.freq === "daily") return { current: null, next: null };
  const { date: today } = dateInTz(atMs, tz);

  if (routine.freq === "monthly") {
    const [y, m] = today.split("-").map(Number);
    const anchor = routine.anchor ?? 1;
    const cur = monthlyOccurrence(y, m, anchor, today);
    const next = monthlyOccurrence(
      m === 12 ? y + 1 : y,
      m === 12 ? 1 : m + 1,
      anchor,
      today,
    );
    return { current: cur, next };
  }

  if (routine.freq === "weekly") {
    const anchor = routine.anchor ?? 1;
    const todayDow = dayOfWeek(today);
    // "current week" = próxima ocorrência do anchor a partir de domingo-da-semana-atual.
    const daysBackToAnchor = (todayDow - anchor + 7) % 7;
    const curDate = addDaysIso(today, -daysBackToAnchor); // pode ser passado se anchor < dow
    const cur: RoutineOccurrence = {
      date: curDate,
      period: isoWeekKey(curDate),
      daysAway: daysBetween(today, curDate),
      isOverdue: daysBetween(today, curDate) < 0,
    };
    // próxima semana = +7
    const nextDate = addDaysIso(curDate, 7);
    const next: RoutineOccurrence = {
      date: nextDate,
      period: isoWeekKey(nextDate),
      daysAway: daysBetween(today, nextDate),
      isOverdue: false,
    };
    return { current: cur, next };
  }

  return { current: null, next: null };
}

function monthlyOccurrence(
  y: number,
  m: number, // 1-12
  anchor: number,
  today: string,
): RoutineOccurrence {
  // Date.UTC(y, m, 0) → último dia do mês m (porque JS é 0-indexed: m aqui passa como o "próximo" mês 0-indexed e dia 0).
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(anchor, lastDay);
  const date = `${y}-${pad(m)}-${pad(day)}`;
  const daysAway = daysBetween(today, date);
  return { date, period: `${y}-${pad(m)}`, daysAway, isOverdue: daysAway < 0 };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
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
