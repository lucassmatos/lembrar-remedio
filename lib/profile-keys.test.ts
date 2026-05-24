import { describe, it, expect } from "vitest";
import { sanitizeMessageKey, parseMessageKey } from "./profile-keys";

describe("profile-keys", () => {
  it("sanitizes slotKey + sub to base64url (no @, |, #, =, +, /)", () => {
    const k = sanitizeMessageKey("abc123@08:00", "google-oauth2|456");
    expect(k).not.toMatch(/[@|#=+/]/);
    expect(k.length).toBeGreaterThan(0);
  });

  it("round-trips through parse", () => {
    const slot = "abc123@08:00";
    const sub = "google-oauth2|456";
    const k = sanitizeMessageKey(slot, sub);
    const parsed = parseMessageKey(k);
    expect(parsed.slotKey).toBe(slot);
    expect(parsed.sub).toBe(sub);
  });

  it("rejects malformed parse input", () => {
    expect(() => parseMessageKey("notbase64!!!")).toThrow();
  });
});
