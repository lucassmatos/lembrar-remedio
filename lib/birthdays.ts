import { daysBetween, dateInTz } from "./schedule";
import type { Birthday } from "./types";

/**
 * Próxima ocorrência do aniversário em YYYY-MM-DD (tz do usuário).
 * Se o MM-DD já passou esse ano, vai pro próximo ano. Se for hoje, retorna hoje.
 */
export function nextBirthdayDate(b: Birthday, atMs: number, tz: string): string {
  const { date: today } = dateInTz(atMs, tz);
  const [yToday, mToday, dToday] = today.split("-").map(Number);
  // Se a data desse ano ainda não passou, é esse ano. Senão próximo ano.
  const thisYearPassed =
    mToday > b.month || (mToday === b.month && dToday > b.day);
  const targetYear = thisYearPassed ? yToday + 1 : yToday;
  // Fevereiro 29 num ano não-bissexto: cai pra 28.
  const day = clampDay(targetYear, b.month, b.day);
  return `${targetYear}-${pad(b.month)}-${pad(day)}`;
}

/** Quantos dias até a próxima ocorrência (0 = hoje). */
export function daysUntilBirthday(b: Birthday, atMs: number, tz: string): number {
  const { date: today } = dateInTz(atMs, tz);
  return daysBetween(today, nextBirthdayDate(b, atMs, tz));
}

/** É hoje? Mesmo MM-DD que hoje no tz. */
export function isBirthdayToday(b: Birthday, atMs: number, tz: string): boolean {
  const { date: today } = dateInTz(atMs, tz);
  const [, m, d] = today.split("-").map(Number);
  return m === b.month && d === b.day;
}

function clampDay(year: number, month: number, day: number): number {
  // Date.UTC(y, month, 0) → último dia do mês `month` (1-indexed).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, lastDay);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
