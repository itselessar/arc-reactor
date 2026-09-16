export type NetworkName = "mainnet" | "testnet";
export type AutoSellTimeUnit = "minutes" | "hours" | "days";

export interface ReactorConfig {
  network: NetworkName;
  rpcHttp: string;
  factoryAddress: string;
  routerAddress: string;
  quoteTokenAddress: string;
  targetTokenAddress: string;
  amountInUsdc: string;
  minLiquidityUsdc: string;
  slippagePercent: number;
  maxFeeGwei: number;
  priorityFeeGwei: number;
  pollMs: number;
  dryRun: boolean;
  autoSellEnabled: boolean;
  autoSellAfterValue: number;
  autoSellAfterUnit: AutoSellTimeUnit;
  autoSellAtMultiple: number;
}

export interface Position {
  network: NetworkName;
  token: string;
  symbol: string;
  amount: string;
  amountRaw: string;
  costUsdc: string;
  buyHash: string;
  openedAt: number;
}

export interface ReactorEvent {
  id: string;
  at: number;
  level: "info" | "success" | "warning" | "error";
  message: string;
  txHash?: string;
}

export interface AuditItem {
  key: string;
  label: string;
  status: "pending" | "pass" | "warning" | "fail";
  value: string;
}

export interface PublicState {
  running: boolean;
  walletAddress: string | null;
  config: ReactorConfig;
  positions: Position[];
  audits: AuditItem[];
}
