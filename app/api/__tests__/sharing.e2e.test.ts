import { vi } from "vitest";
vi.hoisted(() => { process.env.LR_DEV_LOCAL = "1"; });

import { describe, it, expect, beforeEach } from "vitest";
import { _resetDevStore } from "../../../lib/dev-store";
import { putProfile, putShareLink } from "../../../lib/ddb";
import { requireProfileAccess, ForbiddenError } from "../../../lib/sharing";

beforeEach(() => _resetDevStore());

describe("sharing e2e — permission enforcement", () => {
  it("caregiver cannot use requireProfileAccess(editor)", async () => {
    await putProfile("ownerA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 1,
    });
    await putShareLink("carerB", {
      ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1,
    });
    await expect(requireProfileAccess("carerB", "p1", "editor")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireProfileAccess("carerB", "p1", "viewer")).resolves.toBeDefined();
  });

  it("partner can edit", async () => {
    await putProfile("ownerA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "ownerA",
      sharedWith: [{ sub: "partnerB", role: "partner", addedAt: 1 }],
      version: 1,
    });
    await putShareLink("partnerB", {
      ownerSub: "ownerA", profileId: "p1", role: "partner", addedAt: 1,
    });
    await expect(requireProfileAccess("partnerB", "p1", "editor")).resolves.toBeDefined();
  });
});
