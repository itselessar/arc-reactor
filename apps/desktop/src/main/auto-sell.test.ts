import { describe, expect, it } from "vitest";
import { getAutoSellDeadline, hasReachedMultiple } from "./auto-sell";

describe("auto sell triggers", () => {
  it("converts minute, hour, and day deadlines", () => {
    expect(getAutoSellDeadline(1_000, 5, "minutes")).toBe(301_000);
    expect(getAutoSellDeadline(1_000, 2, "hours")).toBe(7_201_000);
    expect(getAutoSellDeadline(1_000, 1, "days")).toBe(86_401_000);
  });

  it("triggers at the configured value multiple", () => {
    expect(hasReachedMultiple(19_999_999n, 10_000_000n, 2)).toBe(false);
    expect(hasReachedMultiple(20_000_000n, 10_000_000n, 2)).toBe(true);
    expect(hasReachedMultiple(50_000_000n, 10_000_000n, 5)).toBe(true);
  });
});
