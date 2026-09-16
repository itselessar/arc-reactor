import { describe, expect, it } from "vitest";
import { ARC_USDC, DEFAULT_CONFIG, validateConfig } from "./config";

const address = "0x1111111111111111111111111111111111111111";

describe("validateConfig", () => {
  it("accepts a complete Arc configuration", () => {
    const result = validateConfig({ ...DEFAULT_CONFIG, factoryAddress: address, routerAddress: address });
    expect(result.quoteTokenAddress).toBe(ARC_USDC);
  });

  it("requires the Arc gas floor", () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, factoryAddress: address, routerAddress: address, maxFeeGwei: 19 })).toThrow();
  });

  it("requires an exit trigger when auto sell is enabled", () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, factoryAddress: address, routerAddress: address, autoSellEnabled: true })).toThrow();
    expect(validateConfig({ ...DEFAULT_CONFIG, factoryAddress: address, routerAddress: address, autoSellEnabled: true, autoSellAtMultiple: 2 }).autoSellAtMultiple).toBe(2);
  });
});
