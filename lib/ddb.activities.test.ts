import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import {
  listActivities,
  putActivity,
  getActivity,
  deleteActivity,
  findOpenNap,
  listOpenNaps,
  putReminderForProfile,
  putProfile,
  deleteProfileCascade,
  listRemindersForProfile,
} from "./ddb";
import { _resetDevStore } from "./dev-store";
import { nowInTz, addDays } from "./schedule";
import type { FeedActivity, NapActivity, Reminder } from "./types";

const SUB = "u1";
const TZ = "America/Sao_Paulo";

// Fixtures usam a data de hoje no TZ pra não ficarem stale conforme o calendário
// avança (findOpenNap/listOpenNaps só olham hoje + ontem).
const TODAY = nowInTz(TZ).date;

function nap(over: Partial<NapActivity> = {}): NapActivity {
  return {
    id: "n1",
    type: "nap",
    profileId: "p1",
    date: TODAY,
    createdAt: 1,
    startedAt: Date.parse(`${TODAY}T14:00:00Z`),
    ...over,
  };
}
function feed(over: Partial<FeedActivity> = {}): FeedActivity {
  return {
    id: "f1",
    type: "feed",
    profileId: "p1",
    date: TODAY,
    createdAt: 1,
    side: "left",
    at: Date.parse(`${TODAY}T15:00:00Z`),
    ...over,
  };
}

beforeEach(() => _resetDevStore());

describe("activity CRUD", () => {
  it("put + list por dia retorna o item", async () => {
    await putActivity(SUB, nap());
    const list = await listActivities(SUB, TODAY);
    expect(list.map((a) => a.id)).toEqual(["n1"]);
  });

  it("list filtra pelo bucket do dia", async () => {
    await putActivity(SUB, nap({ id: "today" }));
    await putActivity(SUB, nap({ id: "other", date: "2026-05-23" }));
    const list = await listActivities(SUB, TODAY);
    expect(list.map((a) => a.id)).toEqual(["today"]);
  });

  it("ordena cronologicamente (soneca por startedAt, mamada por at)", async () => {
    await putActivity(SUB, feed({ id: "f", at: Date.parse(`${TODAY}T16:00:00Z`) }));
    await putActivity(SUB, nap({ id: "n", startedAt: Date.parse(`${TODAY}T09:00:00Z`) }));
    const list = await listActivities(SUB, TODAY);
    expect(list.map((a) => a.id)).toEqual(["n", "f"]);
  });

  it("get + delete roundtrip", async () => {
    await putActivity(SUB, nap());
    expect((await getActivity(SUB, TODAY, "n1"))?.id).toBe("n1");
    await deleteActivity(SUB, TODAY, "n1");
    expect(await getActivity(SUB, TODAY, "n1")).toBeNull();
  });
});

describe("findOpenNap", () => {
  it("acha a soneca em andamento do perfil", async () => {
    await putActivity(SUB, nap({ id: "open" }));
    const open = await findOpenNap(SUB, "p1", TZ);
    expect(open?.id).toBe("open");
  });

  it("ignora soneca já encerrada", async () => {
    await putActivity(SUB, nap({ id: "done", endedAt: Date.now() }));
    expect(await findOpenNap(SUB, "p1", TZ)).toBeNull();
  });

  it("ignora soneca de outro perfil", async () => {
    await putActivity(SUB, nap({ id: "other", profileId: "p2" }));
    expect(await findOpenNap(SUB, "p1", TZ)).toBeNull();
  });

  it("encontra soneca que começou ontem (cruzou a meia-noite)", async () => {
    const today = nowInTz(TZ).date;
    const yesterday = addDays(today, -1);
    await putActivity(SUB, nap({ id: "overnight", date: yesterday }));
    const open = await findOpenNap(SUB, "p1", TZ);
    expect(open?.id).toBe("overnight");
  });
});

describe("listOpenNaps", () => {
  it("retorna sonecas em andamento de todos os perfis, mais recentes primeiro", async () => {
    await putActivity(SUB, nap({ id: "a", profileId: "p1", startedAt: 100 }));
    await putActivity(SUB, nap({ id: "b", profileId: "p2", startedAt: 200 }));
    const open = await listOpenNaps(SUB, TZ);
    expect(open.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("ignora sonecas encerradas", async () => {
    await putActivity(SUB, nap({ id: "done", endedAt: Date.now() }));
    expect(await listOpenNaps(SUB, TZ)).toEqual([]);
  });

  it("deduplica e inclui soneca que começou ontem", async () => {
    const today = nowInTz(TZ).date;
    const yesterday = addDays(today, -1);
    await putActivity(SUB, nap({ id: "overnight", date: yesterday, startedAt: 1 }));
    const open = await listOpenNaps(SUB, TZ);
    expect(open.map((n) => n.id)).toEqual(["overnight"]);
  });
});

describe("deleteProfileCascade inclui activities", () => {
  it("apaga activities do perfil mas preserva as de outro perfil", async () => {
    await putProfile(SUB, { id: "p1", name: "Bebê", color: "sage", createdAt: 1, ownerSub: SUB, sharedWith: [], version: 1 });
    await putProfile(SUB, { id: "p2", name: "Outro", color: "clay", createdAt: 1, ownerSub: SUB, sharedWith: [], version: 1 });
    await putActivity(SUB, nap({ id: "keep", profileId: "p2", date: "2026-05-20" }));
    await putActivity(SUB, feed({ id: "drop", profileId: "p1", date: "2026-05-20" }));

    await deleteProfileCascade(SUB, "p1");

    expect((await listActivities(SUB, "2026-05-20")).map((a) => a.id)).toEqual(["keep"]);
  });

  it("ainda apaga os reminders do perfil (não regrediu)", async () => {
    const rem: Reminder = {
      id: "r1",
      kind: "medication",
      title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1",
      createdAt: 1,
    };
    await putReminderForProfile(rem);
    await deleteProfileCascade(SUB, "p1");
    expect(await listRemindersForProfile("p1")).toEqual([]);
  });
});
