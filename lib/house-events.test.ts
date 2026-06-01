import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import {
  deleteHouseEvent,
  eventsForHousehold,
  getHouseEvent,
  putHouseEvent,
  setPartner,
  deletePartner,
} from "./ddb";
import { _resetDevStore } from "./dev-store";
import type { HouseEvent } from "./types";

beforeEach(() => _resetDevStore());

function event(over: Partial<HouseEvent> = {}): HouseEvent {
  return {
    id: "e1",
    ownerSub: "alice",
    title: "Festa da Lia",
    date: "2026-07-12",
    createdAt: 1,
    ...over,
  };
}

describe("put/get/delete HouseEvent", () => {
  it("roundtrip e delete", async () => {
    await putHouseEvent("alice", event());
    expect(await getHouseEvent("alice", "e1")).toMatchObject({ title: "Festa da Lia" });
    await deleteHouseEvent("alice", "e1");
    expect(await getHouseEvent("alice", "e1")).toBeNull();
  });

  it("editar = put no mesmo id (replace)", async () => {
    await putHouseEvent("alice", event());
    await putHouseEvent("alice", event({ title: "Festa adiada", date: "2026-07-19", time: "18:00" }));
    const got = await getHouseEvent("alice", "e1");
    expect(got).toMatchObject({ title: "Festa adiada", date: "2026-07-19", time: "18:00" });
  });
});

describe("eventsForHousehold", () => {
  it("solo: só os próprios", async () => {
    await putHouseEvent("alice", event({ id: "a1" }));
    expect((await eventsForHousehold("alice")).map((x) => x.id)).toEqual(["a1"]);
  });

  it("com parceiro: dos dois lados", async () => {
    await putHouseEvent("alice", event({ id: "a1" }));
    await putHouseEvent("bob", event({ id: "b1", ownerSub: "bob" }));
    await setPartner("alice", { partnerSub: "bob", since: 1 });
    await setPartner("bob", { partnerSub: "alice", since: 1 });
    expect((await eventsForHousehold("alice")).map((x) => x.id).sort()).toEqual(["a1", "b1"]);
    expect((await eventsForHousehold("bob")).map((x) => x.id).sort()).toEqual(["a1", "b1"]);
  });

  it("desparear esconde eventos do ex", async () => {
    await putHouseEvent("alice", event({ id: "a1" }));
    await putHouseEvent("bob", event({ id: "b1", ownerSub: "bob" }));
    await setPartner("alice", { partnerSub: "bob", since: 1 });
    await setPartner("bob", { partnerSub: "alice", since: 1 });
    expect((await eventsForHousehold("alice")).length).toBe(2);
    await deletePartner("alice");
    await deletePartner("bob");
    expect((await eventsForHousehold("alice")).map((x) => x.id)).toEqual(["a1"]);
  });
});
