import { describe, it, expect } from "vitest";
import { dateInTz, epochFromLocal } from "./schedule";
import { clock } from "./activity";

describe("epochFromLocal", () => {
  const TZ = "America/Sao_Paulo";

  it("é inverso de dateInTz/clock para um horário local", () => {
    const ms = epochFromLocal("2026-05-24", "14:30", TZ);
    const back = dateInTz(ms, TZ);
    expect(back.date).toBe("2026-05-24");
    expect(clock(ms, TZ)).toBe("14:30");
  });

  it("respeita o offset do fuso (UTC-3 em São Paulo, sem DST)", () => {
    const ms = epochFromLocal("2026-05-24", "00:00", TZ);
    // 00:00 em São Paulo (UTC-3) == 03:00 UTC do mesmo dia
    expect(new Date(ms).toISOString()).toBe("2026-05-24T03:00:00.000Z");
  });

  it("roundtrip em UTC", () => {
    const ms = epochFromLocal("2026-01-01", "09:15", "UTC");
    expect(new Date(ms).toISOString()).toBe("2026-01-01T09:15:00.000Z");
  });
});
