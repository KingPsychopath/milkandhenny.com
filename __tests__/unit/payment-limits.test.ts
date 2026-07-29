import { describe, expect, it } from "vitest";

import {
  getCheckoutMinimumMinor,
  isCheckoutTotalSupported,
  minimumCheckoutQuantity,
} from "@/features/tickets/payment-limits";

describe("checkout payment limits", () => {
  it("requires at least 30p for GBP checkout", () => {
    expect(getCheckoutMinimumMinor("GBP")).toBe(30);
    expect(minimumCheckoutQuantity(10, "GBP")).toBe(3);
    expect(isCheckoutTotalSupported(10, 2, "GBP")).toBe(false);
    expect(isCheckoutTotalSupported(10, 3, "GBP")).toBe(true);
  });

  it("does not invent a minimum for unsupported currencies", () => {
    expect(getCheckoutMinimumMinor("XYZ")).toBeUndefined();
    expect(minimumCheckoutQuantity(10, "XYZ")).toBe(1);
    expect(isCheckoutTotalSupported(10, 1, "XYZ")).toBe(true);
  });
});
