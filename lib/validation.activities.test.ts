import { describe, it, expect } from "vitest";
import { ActivityPostSchema, ActivityPatchSchema } from "./validation";

describe("ActivityPostSchema", () => {
  it("aceita soneca mínima (só o type)", () => {
    expect(ActivityPostSchema.safeParse({ type: "nap" }).success).toBe(true);
  });
  it("aceita soneca com startedAt e profileId", () => {
    const r = ActivityPostSchema.safeParse({ type: "nap", profileId: "abc123", startedAt: 1_700_000_000_000 });
    expect(r.success).toBe(true);
  });
  it("feed exige method", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed" }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", side: "left" }).success).toBe(false);
  });
  it("peito exige lado", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "breast" }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "breast", side: "left" }).success).toBe(true);
  });
  it("mamadeira exige ml e conteúdo", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "bottle", amountMl: 120 }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "bottle", amountMl: 120, content: "formula" }).success).toBe(true);
  });
  it("extração exige ml e lado", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "pump", amountMl: 90 }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "pump", amountMl: 90, side: "right" }).success).toBe(true);
  });
  it("rejeita ml fora do intervalo", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "bottle", amountMl: 0, content: "formula" }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "bottle", amountMl: 9999, content: "formula" }).success).toBe(false);
  });
  it("rejeita type desconhecido", () => {
    expect(ActivityPostSchema.safeParse({ type: "diaper" }).success).toBe(false);
  });
  it("rejeita método inválido", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "telepatia", side: "left" }).success).toBe(false);
  });
  it("rejeita lado inválido", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", method: "breast", side: "middle" }).success).toBe(false);
  });
  it("rejeita campos extras (strict)", () => {
    expect(ActivityPostSchema.safeParse({ type: "nap", foo: 1 }).success).toBe(false);
  });
});

describe("ActivityPatchSchema", () => {
  it("exige date", () => {
    expect(ActivityPatchSchema.safeParse({}).success).toBe(false);
    expect(ActivityPatchSchema.safeParse({ date: "2026-05-24" }).success).toBe(true);
  });
  it("aceita encerrar soneca (endedAt)", () => {
    expect(ActivityPatchSchema.safeParse({ date: "2026-05-24", endedAt: 1_700_000_000_000 }).success).toBe(true);
  });
  it("aceita endedAt null (reabrir)", () => {
    expect(ActivityPatchSchema.safeParse({ date: "2026-05-24", endedAt: null }).success).toBe(true);
  });
  it("aceita editar lado", () => {
    expect(ActivityPatchSchema.safeParse({ date: "2026-05-24", side: "right" }).success).toBe(true);
  });
  it("rejeita lado inválido no patch", () => {
    expect(ActivityPatchSchema.safeParse({ date: "2026-05-24", side: "x" }).success).toBe(false);
  });
});
