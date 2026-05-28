import { describe, it, expect } from "vitest";
import {
  isCaregiver,
  isPartner,
  type Profile,
  type PartnerRecord,
  type ProfileShareLink,
} from "./types";

describe("sharing types", () => {
  it("Profile carries ownerSub, sharedWith, version", () => {
    const p: Profile = {
      id: "p1",
      name: "Filho",
      color: "sage",
      createdAt: 1,
      ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "partner", addedAt: 2 }],
      version: 1,
    };
    expect(p.sharedWith[0].role).toBe("partner");
    expect(p.version).toBe(1);
  });

  it("isPartner/isCaregiver discriminate the role on a share entry", () => {
    const entry = { sub: "x", role: "caregiver" as const, addedAt: 1 };
    expect(isCaregiver(entry)).toBe(true);
    expect(isPartner(entry)).toBe(false);
  });

  it("PartnerRecord and ProfileShareLink shapes compile", () => {
    const partner: PartnerRecord = {
      partnerSub: "b",
      partnerEmail: "b@example.com",
      partnerName: "B",
      since: 1,
    };
    const link: ProfileShareLink = {
      ownerSub: "a",
      profileId: "p1",
      role: "caregiver",
      addedAt: 1,
    };
    expect(partner.partnerSub).toBe("b");
    expect(link.profileId).toBe("p1");
  });
});
