import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import {
  putHouseList,
  listsForHousehold,
  getHouseList,
  deleteHouseListCascade,
  putListItem,
  listItems,
  setPartner,
  deletePartner,
} from "./ddb";
import { requireHouseholdAccess, ForbiddenError } from "./sharing";
import { _resetDevStore } from "./dev-store";
import type { HouseList, ListItem } from "./types";

beforeEach(() => _resetDevStore());

function list(over: Partial<HouseList> = {}): HouseList {
  return { id: "l1", ownerSub: "alice", title: "Compras", kind: "compras", createdAt: 1, ...over };
}
function item(over: Partial<ListItem> = {}): ListItem {
  return { id: "i1", listId: "l1", text: "leite", done: false, addedBy: "alice", createdAt: 1, ...over };
}

async function pair(a: string, b: string) {
  await setPartner(a, { partnerSub: b, since: 1 });
  await setPartner(b, { partnerSub: a, since: 1 });
}

describe("listsForHousehold", () => {
  it("solo: só as próprias", async () => {
    await putHouseList("alice", list());
    expect((await listsForHousehold("alice")).map((l) => l.id)).toEqual(["l1"]);
  });

  it("com parceiro: próprias + do parceiro, mais antigas primeiro, dos dois lados", async () => {
    await putHouseList("alice", list({ id: "l1", createdAt: 1 }));
    await putHouseList("bob", list({ id: "l2", ownerSub: "bob", createdAt: 2 }));
    await pair("alice", "bob");
    expect((await listsForHousehold("alice")).map((l) => l.id)).toEqual(["l1", "l2"]);
    expect((await listsForHousehold("bob")).map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("desparear esconde as listas do ex-parceiro na hora", async () => {
    await putHouseList("alice", list({ id: "l1" }));
    await putHouseList("bob", list({ id: "l2", ownerSub: "bob", createdAt: 2 }));
    await pair("alice", "bob");
    expect((await listsForHousehold("alice")).length).toBe(2);
    await deletePartner("alice");
    await deletePartner("bob");
    expect((await listsForHousehold("alice")).map((l) => l.id)).toEqual(["l1"]);
  });
});

describe("requireHouseholdAccess", () => {
  it("owner passa", async () => {
    await expect(requireHouseholdAccess("alice", "alice")).resolves.toBeUndefined();
  });

  it("parceiro passa", async () => {
    await pair("alice", "bob");
    await expect(requireHouseholdAccess("alice", "bob")).resolves.toBeUndefined();
  });

  it("estranho é barrado (ForbiddenError → 403)", async () => {
    await expect(requireHouseholdAccess("alice", "carol")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ex-parceiro vira estranho após unpair", async () => {
    await pair("alice", "bob");
    await deletePartner("alice");
    await expect(requireHouseholdAccess("alice", "bob")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("cascade + items", () => {
  it("deleteHouseListCascade apaga a lista e todos os itens", async () => {
    await putHouseList("alice", list());
    await putListItem("alice", item({ id: "i1" }));
    await putListItem("alice", item({ id: "i2", text: "pão" }));
    expect((await listItems("alice", "l1")).length).toBe(2);
    await deleteHouseListCascade("alice", "l1");
    expect(await getHouseList("alice", "l1")).toBeNull();
    expect((await listItems("alice", "l1")).length).toBe(0);
  });

  it("itens ordenados por createdAt", async () => {
    await putHouseList("alice", list());
    await putListItem("alice", item({ id: "i2", createdAt: 2 }));
    await putListItem("alice", item({ id: "i1", createdAt: 1 }));
    expect((await listItems("alice", "l1")).map((i) => i.id)).toEqual(["i1", "i2"]);
  });
});
