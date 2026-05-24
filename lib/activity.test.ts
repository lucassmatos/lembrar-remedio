import { describe, it, expect } from "vitest";
import { activityTime, buildSummary, feedDetail, nextSide, formatDuration } from "./activity";
import { feedMethod, isNap, isFeed, isOngoingNap } from "./types";
import type { FeedActivity, NapActivity } from "./types";

const napAt = (startedAt: number, endedAt?: number): NapActivity => ({
  id: "n",
  type: "nap",
  profileId: "p1",
  date: "2026-05-24",
  createdAt: 1,
  startedAt,
  ...(endedAt != null ? { endedAt } : {}),
});
const feedAt = (at: number): FeedActivity => ({
  id: "f",
  type: "feed",
  profileId: "p1",
  date: "2026-05-24",
  createdAt: 1,
  side: "left",
  at,
});

describe("nextSide", () => {
  it("sugere esquerdo quando não há mamada anterior", () => {
    expect(nextSide(undefined)).toBe("left");
  });
  it("alterna para o lado oposto", () => {
    expect(nextSide("left")).toBe("right");
    expect(nextSide("right")).toBe("left");
  });
});

describe("formatDuration", () => {
  it("mostra horas e minutos", () => {
    expect(formatDuration(75 * 60_000)).toBe("1h 15m");
  });
  it("omite horas quando menos de uma hora", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });
  it("omite minutos quando hora cheia", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h");
  });
  it("nunca fica negativo", () => {
    expect(formatDuration(-5000)).toBe("0m");
  });
  it("limite logo abaixo de uma hora", () => {
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });
  it("carrega o minuto após a hora cheia", () => {
    expect(formatDuration(61 * 60_000)).toBe("1h 1m");
  });
});

describe("activityTime", () => {
  it("usa startedAt para soneca e at para mamada", () => {
    expect(activityTime(napAt(100))).toBe(100);
    expect(activityTime(feedAt(200))).toBe(200);
  });
});

describe("buildSummary", () => {
  it("sem nada: zero mamadas", () => {
    expect(buildSummary([])).toBe("0 mamadas");
  });
  it("singular para uma mamada", () => {
    expect(buildSummary([feedAt(1)])).toBe("1 mamada");
  });
  it("soma sono de sonecas encerradas e conta mamadas", () => {
    const nap = napAt(0, 75 * 60_000); // 1h15m
    expect(buildSummary([nap, feedAt(1), feedAt(2)])).toBe("1h 15m de sono · 2 mamadas");
  });
  it("ignora soneca em andamento no total de sono", () => {
    expect(buildSummary([napAt(0)])).toBe("0 mamadas");
  });
  it("clampa duração negativa (endedAt < startedAt) em zero", () => {
    expect(buildSummary([napAt(100_000, 0)])).toBe("0 mamadas");
  });
  it("mamadeira conta como mamada", () => {
    const bottle: FeedActivity = { ...feedAt(1), id: "b", method: "bottle", side: undefined, amountMl: 120, content: "formula" };
    expect(buildSummary([feedAt(1), bottle])).toBe("2 mamadas");
  });
  it("extração não é mamada e soma ml à parte", () => {
    const pump: FeedActivity = { ...feedAt(1), id: "p", method: "pump", side: "right", amountMl: 90 };
    expect(buildSummary([feedAt(2), pump])).toBe("1 mamada · 90 ml extraído");
  });
});

describe("feedMethod", () => {
  it("trata registro legado (sem method) como peito", () => {
    expect(feedMethod(feedAt(1))).toBe("breast");
  });
});

describe("feedDetail", () => {
  it("peito: lado", () => {
    expect(feedDetail(feedAt(1))).toBe("lado esquerdo");
  });
  it("mamadeira: ml · conteúdo", () => {
    const bottle: FeedActivity = { ...feedAt(1), method: "bottle", side: undefined, amountMl: 120, content: "breastmilk" };
    expect(feedDetail(bottle)).toBe("120 ml · leite materno");
  });
  it("extração: ml · lado", () => {
    const pump: FeedActivity = { ...feedAt(1), method: "pump", side: "right", amountMl: 90 };
    expect(feedDetail(pump)).toBe("90 ml · lado direito");
  });
});

describe("activity type guards", () => {
  const nap: NapActivity = {
    id: "n1",
    type: "nap",
    profileId: "p1",
    date: "2026-05-24",
    createdAt: 1,
    startedAt: 1,
  };
  const endedNap: NapActivity = { ...nap, id: "n2", endedAt: 2 };
  const feed: FeedActivity = {
    id: "f1",
    type: "feed",
    profileId: "p1",
    date: "2026-05-24",
    createdAt: 1,
    side: "left",
    at: 1,
  };

  it("isNap / isFeed discriminam pelo type", () => {
    expect(isNap(nap)).toBe(true);
    expect(isFeed(nap)).toBe(false);
    expect(isFeed(feed)).toBe(true);
    expect(isNap(feed)).toBe(false);
  });
  it("isOngoingNap só é true para soneca sem fim", () => {
    expect(isOngoingNap(nap)).toBe(true);
    expect(isOngoingNap(endedNap)).toBe(false);
    expect(isOngoingNap(feed)).toBe(false);
  });
});
