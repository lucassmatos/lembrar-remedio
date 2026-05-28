import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import {
  deleteHouseRoutineCascade,
  getHouseRoutine,
  getRoutineDone,
  putHouseRoutine,
  putRoutineDone,
  routinesForHousehold,
  setPartner,
  deletePartner,
} from "./ddb";
import { freqLabel, isDueOn, periodFor, timelineTime } from "./routines";
import { _resetDevStore } from "./dev-store";
import type { HouseRoutine, RoutineDone } from "./types";

const TZ = "America/Sao_Paulo";
// 2026-05-25 (segunda) 12:00 em SP → UTC = 15:00. UTC-3 sem DST no Brasil.
const MON_2026_05_25 = Date.UTC(2026, 4, 25, 15, 0);

beforeEach(() => _resetDevStore());

function routine(over: Partial<HouseRoutine> = {}): HouseRoutine {
  return {
    id: "r1",
    ownerSub: "alice",
    title: "Escola Matheus",
    freq: "monthly",
    anchor: 25,
    createdAt: 1,
    ...over,
  };
}

describe("periodFor", () => {
  it("daily: YYYY-MM-DD no tz do usuário", () => {
    const r = routine({ freq: "daily", anchor: undefined });
    expect(periodFor(r, MON_2026_05_25, TZ)).toBe("2026-05-25");
  });

  it("monthly: YYYY-MM (mesmo período mesmo se dom != anchor)", () => {
    const r = routine({ freq: "monthly", anchor: 25 });
    expect(periodFor(r, MON_2026_05_25, TZ)).toBe("2026-05");
    // outro dia do mesmo mês → mesmo período
    const dia2 = Date.UTC(2026, 4, 2, 15, 0);
    expect(periodFor(r, dia2, TZ)).toBe("2026-05");
  });

  it("weekly: YYYY-Www ISO", () => {
    const r = routine({ freq: "weekly", anchor: 1 });
    expect(periodFor(r, MON_2026_05_25, TZ)).toMatch(/^2026-W\d{2}$/);
  });
});

describe("isDueOn", () => {
  it("daily: sempre devida", () => {
    expect(isDueOn(routine({ freq: "daily", anchor: undefined }), MON_2026_05_25, TZ)).toBe(true);
  });

  it("monthly: devida só no dia do mês = anchor", () => {
    expect(isDueOn(routine({ freq: "monthly", anchor: 25 }), MON_2026_05_25, TZ)).toBe(true);
    expect(isDueOn(routine({ freq: "monthly", anchor: 5 }), MON_2026_05_25, TZ)).toBe(false);
  });

  it("weekly: devida só no dia da semana = anchor (segunda = 1)", () => {
    // 2026-05-25 é segunda (dow=1)
    expect(isDueOn(routine({ freq: "weekly", anchor: 1 }), MON_2026_05_25, TZ)).toBe(true);
    expect(isDueOn(routine({ freq: "weekly", anchor: 3 }), MON_2026_05_25, TZ)).toBe(false);
  });
});

describe("freqLabel + timelineTime", () => {
  it("labels humanos", () => {
    expect(freqLabel(routine({ freq: "daily" }))).toBe("todo dia");
    expect(freqLabel(routine({ freq: "monthly", anchor: 25 }))).toBe("todo dia 25");
    expect(freqLabel(routine({ freq: "weekly", anchor: 2 }))).toBe("toda terça");
  });

  it("timelineTime: hora do usuário ou 08:00 default", () => {
    expect(timelineTime(routine())).toBe("08:00");
    expect(timelineTime(routine({ time: "14:30" }))).toBe("14:30");
  });
});

describe("routinesForHousehold", () => {
  it("solo: só as próprias", async () => {
    await putHouseRoutine("alice", routine({ id: "a1" }));
    const r = await routinesForHousehold("alice");
    expect(r.map((x) => x.id)).toEqual(["a1"]);
  });

  it("com parceiro: dos dois lados, ordenadas por createdAt", async () => {
    await putHouseRoutine("alice", routine({ id: "a1", createdAt: 1 }));
    await putHouseRoutine("bob", routine({ id: "b1", ownerSub: "bob", createdAt: 2 }));
    await setPartner("alice", { partnerSub: "bob", since: 1 });
    await setPartner("bob", { partnerSub: "alice", since: 1 });
    expect((await routinesForHousehold("alice")).map((x) => x.id)).toEqual(["a1", "b1"]);
    expect((await routinesForHousehold("bob")).map((x) => x.id)).toEqual(["a1", "b1"]);
  });

  it("desparear esconde rotinas do ex", async () => {
    await putHouseRoutine("alice", routine({ id: "a1" }));
    await putHouseRoutine("bob", routine({ id: "b1", ownerSub: "bob" }));
    await setPartner("alice", { partnerSub: "bob", since: 1 });
    await setPartner("bob", { partnerSub: "alice", since: 1 });
    expect((await routinesForHousehold("alice")).length).toBe(2);
    await deletePartner("alice");
    await deletePartner("bob");
    expect((await routinesForHousehold("alice")).map((x) => x.id)).toEqual(["a1"]);
  });
});

describe("cascade + done", () => {
  it("deleteHouseRoutineCascade apaga rotina e marcações de feito", async () => {
    await putHouseRoutine("alice", routine());
    const done: RoutineDone = { routineId: "r1", period: "2026-05", doneBy: "alice", doneAt: 1 };
    await putRoutineDone("alice", done);
    await putRoutineDone("alice", { ...done, period: "2026-04" });
    expect(await getRoutineDone("alice", "r1", "2026-05")).not.toBeNull();
    await deleteHouseRoutineCascade("alice", "r1");
    expect(await getHouseRoutine("alice", "r1")).toBeNull();
    expect(await getRoutineDone("alice", "r1", "2026-05")).toBeNull();
    expect(await getRoutineDone("alice", "r1", "2026-04")).toBeNull();
  });
});
