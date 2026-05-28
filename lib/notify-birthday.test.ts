import { describe, it, expect } from "vitest";
import { computeDigest, formatPush, formatTelegram } from "./notify-birthday";
import type { Birthday } from "./types";

const TZ = "America/Sao_Paulo";

function bday(over: Partial<Birthday> = {}): Birthday {
  return {
    id: "b1",
    ownerSub: "alice",
    name: "Pri",
    month: 5,
    day: 28,
    createdAt: 1,
    ...over,
  };
}

// Quinta-feira normal: dia 28/05/2026, não é dia 1 nem segunda.
const NORMAL_THU = Date.UTC(2026, 4, 28, 15, 0); // 12:00 SP
// Primeiro do mês: 01/06/2026 (segunda-feira). Dispara mensal E semanal.
const MON_JUN_1 = Date.UTC(2026, 5, 1, 15, 0);
// Segunda-feira "normal": 25/05/2026. Dispara só semanal.
const MON_MAY_25 = Date.UTC(2026, 4, 25, 15, 0);
// Dia 1 num dia útil que NÃO é segunda: 01/07/2026 (quarta). Dispara só mensal.
const WED_JUL_1 = Date.UTC(2026, 6, 1, 15, 0);

describe("computeDigest", () => {
  it("hoje vazio: shouldNotify=false", () => {
    const r = computeDigest([bday({ month: 6, day: 15 })], NORMAL_THU, TZ);
    expect(r.shouldNotify).toBe(false);
    expect(r.today).toEqual([]);
    expect(r.thisMonth).toEqual([]);
    expect(r.thisWeek).toEqual([]);
  });

  it("aniversário hoje em dia normal: só today", () => {
    const list = [bday({ id: "p", month: 5, day: 28 }), bday({ id: "m", month: 6, day: 15 })];
    const r = computeDigest(list, NORMAL_THU, TZ);
    expect(r.shouldNotify).toBe(true);
    expect(r.today.map((b) => b.id)).toEqual(["p"]);
    expect(r.thisMonth).toEqual([]);
    expect(r.thisWeek).toEqual([]);
  });

  it("segunda-feira normal: só thisWeek (próx 7 dias)", () => {
    const list = [
      bday({ id: "a", month: 5, day: 26 }), // terça, 1 dia
      bday({ id: "b", month: 5, day: 30 }), // sábado, 5 dias
      bday({ id: "c", month: 6, day: 2 }),  // 8 dias → fora
      bday({ id: "d", month: 5, day: 25 }), // hoje (segunda)
    ];
    const r = computeDigest(list, MON_MAY_25, TZ);
    expect(r.shouldNotify).toBe(true);
    expect(r.today.map((b) => b.id)).toEqual(["d"]);
    // Ordem por daysAway crescente: d(0), a(1), b(5). c não entra.
    expect(r.thisWeek.map((b) => b.id)).toEqual(["d", "a", "b"]);
    expect(r.thisMonth).toEqual([]);
  });

  it("dia 1 num dia útil normal: só thisMonth (todos do mês), ordenados por dia", () => {
    const list = [
      bday({ id: "x", month: 7, day: 25 }),
      bday({ id: "y", month: 7, day: 5 }),
      bday({ id: "z", month: 8, day: 1 }), // outro mês, fora
      bday({ id: "h", month: 7, day: 1 }), // hoje
    ];
    const r = computeDigest(list, WED_JUL_1, TZ);
    expect(r.shouldNotify).toBe(true);
    expect(r.today.map((b) => b.id)).toEqual(["h"]);
    expect(r.thisMonth.map((b) => b.id)).toEqual(["h", "y", "x"]);
    expect(r.thisWeek).toEqual([]);
  });

  it("01/06 numa segunda: mensal + semanal juntos", () => {
    const list = [
      bday({ id: "m1", month: 6, day: 15 }), // mensal (fora dos 7 dias)
      bday({ id: "w1", month: 6, day: 3 }),  // semanal (2 dias) + mensal
      bday({ id: "today", month: 6, day: 1 }), // hoje (e mensal e semanal)
    ];
    const r = computeDigest(list, MON_JUN_1, TZ);
    expect(r.today.map((b) => b.id)).toEqual(["today"]);
    expect(r.thisMonth.map((b) => b.id)).toEqual(["today", "w1", "m1"]);
    expect(r.thisWeek.map((b) => b.id)).toEqual(["today", "w1"]);
  });
});

describe("formatTelegram", () => {
  it("inclui só seções não vazias", () => {
    const text = formatTelegram({
      today: [bday({ name: "Pri" })],
      thisMonth: [],
      thisWeek: [],
      shouldNotify: true,
    });
    expect(text).toContain("Hoje");
    expect(text).toContain("Pri");
    expect(text).not.toContain("semana");
    expect(text).not.toContain("mês");
  });

  it("escapa HTML no nome", () => {
    const text = formatTelegram({
      today: [bday({ name: "A <b>fake</b>" })],
      thisMonth: [],
      thisWeek: [],
      shouldNotify: true,
    });
    expect(text).toContain("&lt;b&gt;fake&lt;/b&gt;");
    expect(text).not.toContain("<b>fake</b>");
  });
});

describe("formatPush", () => {
  it("hoje > semana > mês de prioridade", () => {
    const out = formatPush({
      today: [bday({ name: "Pri" }), bday({ name: "Matheus" })],
      thisMonth: [bday({ name: "Vô" })],
      thisWeek: [bday({ name: "Sobrinho" })],
      shouldNotify: true,
    });
    expect(out.title).toBe("Aniversários hoje");
    expect(out.body).toBe("Pri, Matheus");
  });

  it("título singular quando 1 aniversário hoje", () => {
    const out = formatPush({
      today: [bday({ name: "Pri" })],
      thisMonth: [],
      thisWeek: [],
      shouldNotify: true,
    });
    expect(out.title).toBe("Aniversário hoje");
  });
});
