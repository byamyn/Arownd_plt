import { describe, expect, it } from "vitest";
import { resolveMerchantAccessStatus, selectActiveStoreMembership } from "@/lib/merchant-state";

describe("resolveMerchantAccessStatus", () => {
  it("allows merchant mode only when account type, role, and owned store agree", () => {
    expect(resolveMerchantAccessStatus({ accountType: "merchant", roles: ["merchant"], hasOwnedStore: true })).toBe("merchant_ready");
  });
  it("keeps a personal account in personal mode without merchant capabilities", () => {
    expect(resolveMerchantAccessStatus({ accountType: "personal", roles: [], hasOwnedStore: false })).toBe("personal");
  });
  it("allows a personal account to enter Studio through an explicit store team membership", () => {
    expect(resolveMerchantAccessStatus({
      accountType: "personal",
      roles: [],
      hasOwnedStore: false,
      hasTeamMembership: true
    })).toBe("merchant_ready");
  });
  it("identifies an incomplete merchant setup without granting merchant access", () => {
    expect(resolveMerchantAccessStatus({ accountType: "merchant", roles: ["merchant"], hasOwnedStore: false })).toBe("merchant_setup_required");
  });
  it("rejects mismatched account type, role, and store ownership signals", () => {
    expect(resolveMerchantAccessStatus({ accountType: "personal", roles: ["merchant"], hasOwnedStore: true })).toBe("inconsistent");
  });
});

describe("selectActiveStoreMembership", () => {
  const stores = [
    { id: "store-owner", role: "owner" as const },
    { id: "store-staff", role: "staff" as const },
    { id: "store-admin", role: "admin" as const }
  ];

  it("uses the explicitly selected membership when it is still available", () => {
    expect(selectActiveStoreMembership(stores, "store-admin", "store-owner")?.id).toBe("store-admin");
  });

  it("falls back to the owned store when the saved selection is no longer available", () => {
    expect(selectActiveStoreMembership(stores.slice(1), "removed-store", "store-owner")?.id).toBe("store-staff");
  });

  it("uses the first membership when no owned or preferred store exists", () => {
    expect(selectActiveStoreMembership(stores.slice(1), null, null)?.id).toBe("store-staff");
  });

  it("returns null when the account has no store memberships", () => {
    expect(selectActiveStoreMembership([], null, null)).toBeNull();
  });
});
