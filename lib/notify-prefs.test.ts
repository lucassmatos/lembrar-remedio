import { describe, it, expect } from "vitest";
import {
  memberWantsProfileNotifications,
  initialNotifyProfileIds,
} from "./notify-prefs";

describe("memberWantsProfileNotifications", () => {
  it("default (undefined): owner receives, non-owner does not", () => {
    expect(memberWantsProfileNotifications(undefined, "p1", true)).toBe(true);
    expect(memberWantsProfileNotifications(undefined, "p1", false)).toBe(false);
  });

  it("explicit list: receives only listed profiles (ownership irrelevant)", () => {
    expect(memberWantsProfileNotifications(["p1"], "p1", false)).toBe(true);
    expect(memberWantsProfileNotifications(["p1"], "p2", true)).toBe(false);
  });

  it("empty list silences everything, including own profiles", () => {
    expect(memberWantsProfileNotifications([], "p1", true)).toBe(false);
    expect(memberWantsProfileNotifications([], "p1", false)).toBe(false);
  });
});

describe("initialNotifyProfileIds", () => {
  const profiles = [
    { id: "own", isOwner: true },
    { id: "shared", isOwner: false },
  ];

  it("default pre-selects only owned profiles", () => {
    expect(initialNotifyProfileIds(undefined, profiles)).toEqual(["own"]);
  });

  it("explicit list is reflected as-is (intersected with accessible profiles)", () => {
    expect(initialNotifyProfileIds(["shared"], profiles)).toEqual(["shared"]);
    expect(initialNotifyProfileIds(["own", "shared"], profiles).sort()).toEqual([
      "own",
      "shared",
    ]);
  });

  it("empty list pre-selects nothing", () => {
    expect(initialNotifyProfileIds([], profiles)).toEqual([]);
  });
});
