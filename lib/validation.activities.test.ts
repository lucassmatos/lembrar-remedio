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
  it("mamada exige lado", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed" }).success).toBe(false);
    expect(ActivityPostSchema.safeParse({ type: "feed", side: "left" }).success).toBe(true);
  });
  it("rejeita type desconhecido", () => {
    expect(ActivityPostSchema.safeParse({ type: "diaper" }).success).toBe(false);
  });
  it("rejeita lado inválido", () => {
    expect(ActivityPostSchema.safeParse({ type: "feed", side: "middle" }).success).toBe(false);
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
