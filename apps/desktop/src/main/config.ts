import { z } from "zod";
import type { ReactorConfig } from "./types";

export const ARC_USDC = "0x3600000000000000000000000000000000000000";

export const DEFAULT_CONFIG: ReactorConfig = {
  network: "testnet",
  rpcHttp: "https://rpc.testnet.arc.io",
  factoryAddress: "",
  routerAddress: "",
  quoteTokenAddress: ARC_USDC,
  targetTokenAddress: "",
  amountInUsdc: "5",
  minLiquidityUsdc: "1000",
  slippagePercent: 20,
  maxFeeGwei: 30,
  priorityFeeGwei: 1,
  pollMs: 250,
  dryRun: true,
  autoSellEnabled: false,
  autoSellAfterValue: 0,
  autoSellAfterUnit: "minutes",
  autoSellAtMultiple: 0,
};

const addressOrEmpty = z.string().refine(
  (value) => value === "" || /^0x[a-fA-F0-9]{40}$/.test(value),
  "Enter a valid EVM address",
);

export const configSchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  rpcHttp: z.string().url(),
  factoryAddress: addressOrEmpty,
  routerAddress: addressOrEmpty,
  quoteTokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  targetTokenAddress: addressOrEmpty,
  amountInUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  minLiquidityUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  slippagePercent: z.number().min(0.1).max(99),
  maxFeeGwei: z.number().min(20).max(20000),
  priorityFeeGwei: z.number().min(0).max(100),
  pollMs: z.number().int().min(100).max(10000),
  dryRun: z.boolean(),
  autoSellEnabled: z.boolean(),
  autoSellAfterValue: z.number().min(0).max(3650),
  autoSellAfterUnit: z.enum(["minutes", "hours", "days"]),
  autoSellAtMultiple: z.number().refine((value) => value === 0 || (value >= 1.01 && value <= 10000), "Use 0 to disable or at least 1.01x"),
}).refine(
  (value) => !value.autoSellEnabled || value.autoSellAfterValue > 0 || value.autoSellAtMultiple > 0,
  { message: "Enable a time or multiple trigger for auto sell" },
);

export function validateConfig(input: unknown): ReactorConfig {
  const parsed = configSchema.parse(input);
  if (!parsed.factoryAddress || !parsed.routerAddress) {
    throw new Error("Factory and router addresses are required before arming");
  }
  return parsed;
}
