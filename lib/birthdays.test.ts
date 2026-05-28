import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import {
  birthdaysForHousehold,
  deleteBirthday,
  getBirthday,
  listBirthdays,
  putBirthday,
  setPartner,
} from "./ddb";
import {
  ageAtNextBirthday,
  daysUntilBirthday,
  isBirthdayToday,
  nextBirthdayDate,
} from "./birthdays";
import { _resetDevStore } from "./dev-store";
import type { Birthday } from "./types";

const TZ = "America/Sao_Paulo";
// 2026-05-28 (quinta) 12:00 SP → 15:00 UTC
const MAY_28 = Date.UTC(2026, 4, 28, 15, 0);

beforeEach(() => _resetDevStore());

function bday(over: Partial<Birthday> = {}): Birthday {
  return {
    id: "b1",
    ownerSub: "alice",
    name: "Pri",
    month: 6,
    day: 15,
    year: 1989,
    createdAt: 1,
    ...over,
  };
}

describe("nextBirthdayDate", () => {
  it("data deste ano se ainda não passou (hoje 28/5, anver 15/6)", () => {
    expect(nextBirthdayDate(bday({ month: 6, day: 15 }), MAY_28, TZ)).toBe("2026-06-15");
  });

  it("data do ano que vem se já passou (hoje 28/5, anver 5/5)", () => {
    expect(nextBirthdayDate(bday({ month: 5, day: 5 }), MAY_28, TZ)).toBe("2027-05-05");
  });

  it("hoje se for hoje (28/5)", () => {
    expect(nextBirthdayDate(bday({ month: 5, day: 28 }), MAY_28, TZ)).toBe("2026-05-28");
  });

  it("29/2 em ano não-bissexto cai pra 28/2", () => {
    // 2026 não é bissexto. Hoje 28/5/2026. Próximo será 28/2/2027.
    expect(nextBirthdayDate(bday({ month: 2, day: 29 }), MAY_28, TZ)).toBe("2027-02-28");
  });

  it("29/2 em ano bissexto fica 29/2", () => {
    // 2028 é bissexto. Hoje 28/5/2027. Próximo 29/2/2028.
    const MAY_28_2027 = Date.UTC(2027, 4, 28, 15, 0);
    expect(nextBirthdayDate(bday({ month: 2, day: 29 }), MAY_28_2027, TZ)).toBe("2028-02-29");
  });
});

describe("daysUntilBirthday", () => {
  it("0 hoje", () => {
    expect(daysUntilBirthday(bday({ month: 5, day: 28 }), MAY_28, TZ)).toBe(0);
  });
  it("18 dias até 15/6", () => {
    expect(daysUntilBirthday(bday({ month: 6, day: 15 }), MAY_28, TZ)).toBe(18);
  });
});

describe("ageAtNextBirthday", () => {
  it("calcula idade quando ano dado", () => {
    // 15/6/2026 - 1989 = 37 anos
    expect(ageAtNextBirthday(bday({ year: 1989, month: 6, day: 15 }), MAY_28, TZ)).toBe(37);
  });
  it("undefined sem year", () => {
    expect(ageAtNextBirthday(bday({ year: undefined }), MAY_28, TZ)).toBeUndefined();
  });
  it("considera ano que vem (5/5 já passou em 2026, faz idade em 2027)", () => {
    expect(ageAtNextBirthday(bday({ year: 1990, month: 5, day: 5 }), MAY_28, TZ)).toBe(37);
  });
});

describe("isBirthdayToday", () => {
  it("true se MM-DD igual hoje", () => {
    expect(isBirthdayToday(bday({ month: 5, day: 28 }), MAY_28, TZ)).toBe(true);
  });
  it("false caso contrário", () => {
    expect(isBirthdayToday(bday({ month: 6, day: 15 }), MAY_28, TZ)).toBe(false);
  });
});

describe("birthdaysForHousehold", () => {
  it("solo: só os próprios", async () => {
    await putBirthday("alice", bday({ id: "a1" }));
    expect((await birthdaysForHousehold("alice")).map((x) => x.id)).toEqual(["a1"]);
  });

  it("com parceiro: dos dois lados", async () => {
    await putBirthday("alice", bday({ id: "a1" }));
    await putBirthday("bob", bday({ id: "b1", ownerSub: "bob" }));
    await setPartner("alice", { partnerSub: "bob", since: 1 });
    await setPartner("bob", { partnerSub: "alice", since: 1 });
    expect((await birthdaysForHousehold("alice")).map((x) => x.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
    expect((await birthdaysForHousehold("bob")).map((x) => x.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
  });
});

describe("CRUD básico", () => {
  it("put / get / list / delete", async () => {
    await putBirthday("alice", bday());
    expect(await getBirthday("alice", "b1")).toMatchObject({ name: "Pri" });
    expect((await listBirthdays("alice")).length).toBe(1);
    await deleteBirthday("alice", "b1");
    expect(await getBirthday("alice", "b1")).toBeNull();
  });
});
