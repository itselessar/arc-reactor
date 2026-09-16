import { EventEmitter } from "node:events";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
  maxUint256,
  parseGwei,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, factoryAbi, pairAbi, routerAbi } from "./abis";
import { getAutoSellDeadline, hasReachedMultiple } from "./auto-sell";
import type { AuditItem, Position, ReactorConfig, ReactorEvent } from "./types";

const chains: Record<ReactorConfig["network"], Chain> = {
  mainnet: {
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  },
  testnet: {
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SniperEngine extends EventEmitter {
  private readonly config: ReactorConfig;
  private readonly privateKey?: Hex;
  private readonly walletAddress?: Address;
  private readonly publicClient;
  private unwatch?: () => void;
  private autoSellTimer?: NodeJS.Timeout;
  private active = false;
  private busy = false;
  private seen = new Set<string>();
  readonly positions = new Map<string, Position>();

  constructor(config: ReactorConfig, privateKey?: Hex, walletAddress?: string | null, initialPositions: Position[] = []) {
    super();
    this.config = config;
    this.privateKey = privateKey;
    this.walletAddress = walletAddress ? getAddress(walletAddress) : undefined;
    for (const position of initialPositions) {
      if (position.network === config.network) this.positions.set(position.token.toLowerCase(), position);
    }
    this.publicClient = createPublicClient({
      chain: chains[config.network],
      transport: http(config.rpcHttp, { timeout: 10_000, retryCount: 2 }),
      pollingInterval: config.pollMs,
    });
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (!this.config.dryRun && !this.privateKey) throw new Error("Import a wallet before live mode");
    this.active = true;
    const chainId = await this.publicClient.getChainId();
    if (chainId !== chains[this.config.network].id) {
      this.active = false;
      throw new Error(`RPC chain ID ${chainId} does not match ${chains[this.config.network].id}`);
    }
    this.audit("network", "Network match", "pass", `${chains[this.config.network].name} / ${chainId}`);
    this.audit("wallet", "Execution wallet", this.walletAddress ? "pass" : "warning", this.walletAddress ?? "Dry run without wallet");
    this.audit("buy_size", "Configured buy", "pass", `${this.config.amountInUsdc} USDC`);
    const autoSellDescription = this.config.autoSellEnabled
      ? [
          this.config.autoSellAfterValue > 0 ? `${this.config.autoSellAfterValue} ${this.config.autoSellAfterUnit}` : "",
          this.config.autoSellAtMultiple > 0 ? `${this.config.autoSellAtMultiple}x` : "",
        ].filter(Boolean).join(" or ")
      : "Disabled";
    this.audit("auto_sell", "Auto sell plan", this.config.autoSellEnabled ? "pass" : "warning", autoSellDescription);
    const [factoryCode, routerCode] = await Promise.all([
      this.publicClient.getBytecode({ address: getAddress(this.config.factoryAddress) }),
      this.publicClient.getBytecode({ address: getAddress(this.config.routerAddress) }),
    ]);
    if (!factoryCode || factoryCode === "0x") {
      this.active = false;
      this.audit("factory", "Factory contract", "fail", "No bytecode");
      throw new Error("DEX factory address has no contract bytecode");
    }
    this.audit("factory", "Factory contract", "pass", "Bytecode verified");
    if (!routerCode || routerCode === "0x") {
      this.active = false;
      this.audit("router", "Router contract", "fail", "No bytecode");
      throw new Error("DEX router address has no contract bytecode");
    }
    this.audit("router", "Router contract", "pass", "Bytecode verified");
    this.log("success", `Connected to ${chains[this.config.network].name}. Watching factory.`);
    this.unwatch = this.publicClient.watchContractEvent({
      address: getAddress(this.config.factoryAddress),
      abi: factoryAbi,
      eventName: "PairCreated",
      poll: true,
      pollingInterval: this.config.pollMs,
      onLogs: (logs) => {
        for (const log of logs) {
          const args = log.args as { token0?: Address; token1?: Address; pair?: Address };
          void this.onPair(args.token0, args.token1, args.pair);
        }
      },
      onError: (error) => this.log("error", `Factory watcher: ${error.message}`),
    });
    if (this.config.autoSellEnabled && !this.config.dryRun) this.startAutoSellMonitor();
  }

  stop(): void {
    this.active = false;
    this.unwatch?.();
    this.unwatch = undefined;
    if (this.autoSellTimer) clearInterval(this.autoSellTimer);
    this.autoSellTimer = undefined;
    this.log("warning", "REACTOR disarmed");
  }

  async sell(tokenInput: string): Promise<Hex> {
    if (this.busy) throw new Error("Another transaction is already executing");
    this.busy = true;
    try {
      return await this.executeSell(tokenInput);
    } finally {
      this.busy = false;
    }
  }

  private async executeSell(tokenInput: string): Promise<Hex> {
    if (!this.active || this.config.dryRun || !this.privateKey) throw new Error("Live REACTOR must be armed to sell");
    const token = getAddress(tokenInput);
    const position = this.positions.get(token.toLowerCase());
    if (!position) throw new Error("Position was not found in this session");
    const account = privateKeyToAccount(this.privateKey);
    const walletClient = createWalletClient({ account, chain: chains[this.config.network], transport: http(this.config.rpcHttp) });
    const router = getAddress(this.config.routerAddress);
    const quote = getAddress(this.config.quoteTokenAddress);
    const balance = await this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (balance <= 0n) throw new Error("Wallet token balance is zero");
    const path = [token, quote] as Address[];
    const amounts = await this.publicClient.readContract({ address: router, abi: routerAbi, functionName: "getAmountsOut", args: [balance, path] });
    const quotedOut = amounts.at(-1)!;
    const amountOutMin = (quotedOut * BigInt(Math.floor((100 - this.config.slippagePercent) * 100))) / 10_000n;
    const allowance = await this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, router] });
    if (allowance < balance) {
      const approval = await this.publicClient.simulateContract({
        account, address: token, abi: erc20Abi, functionName: "approve", args: [router, maxUint256],
        maxFeePerGas: parseGwei(String(this.config.maxFeeGwei)),
        maxPriorityFeePerGas: parseGwei(String(this.config.priorityFeeGwei)),
      });
      const approvalHash = await walletClient.writeContract(approval.request);
      await this.publicClient.waitForTransactionReceipt({ hash: approvalHash });
    }
    const swap = await this.publicClient.simulateContract({
      account,
      address: router,
      abi: routerAbi,
      functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      args: [balance, amountOutMin, path, account.address, BigInt(Math.floor(Date.now() / 1000) + 60)],
      maxFeePerGas: parseGwei(String(this.config.maxFeeGwei)),
      maxPriorityFeePerGas: parseGwei(String(this.config.priorityFeeGwei)),
    });
    const sellHash = await walletClient.writeContract(swap.request);
    this.log("info", `Sell submitted for ${position.symbol}`, sellHash);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: sellHash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`Sell reverted: ${sellHash}`);
    this.positions.delete(token.toLowerCase());
    this.emit("position-closed", token);
    this.log("success", `Sold ${position.symbol} for about ${formatUnits(quotedOut, 6)} USDC`, sellHash);
    return sellHash;
  }

  private startAutoSellMonitor(): void {
    const intervalMs = Math.max(1000, this.config.pollMs);
    const check = () => void this.checkAutoSells();
    this.autoSellTimer = setInterval(check, intervalMs);
    check();
    this.log("success", "Auto sell monitor armed");
  }

  private async checkAutoSells(): Promise<void> {
    if (!this.active || this.busy || !this.privateKey || !this.walletAddress) return;
    for (const position of this.positions.values()) {
      if (!this.active || this.busy) return;
      const timedExitReached = this.config.autoSellAfterValue > 0
        && Date.now() >= getAutoSellDeadline(position.openedAt, this.config.autoSellAfterValue, this.config.autoSellAfterUnit);
      if (timedExitReached) {
        this.log("warning", `AUTO SELL: ${position.symbol} reached its time limit`);
        try { await this.sell(position.token); } catch (error) {
          this.log("error", `Auto sell failed for ${position.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
        continue;
      }
      if (this.config.autoSellAtMultiple <= 0) continue;
      try {
        const token = getAddress(position.token);
        const quote = getAddress(this.config.quoteTokenAddress);
        const balance = await this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [this.walletAddress] });
        if (balance <= 0n) continue;
        const amounts = await this.publicClient.readContract({
          address: getAddress(this.config.routerAddress),
          abi: routerAbi,
          functionName: "getAmountsOut",
          args: [balance, [token, quote]],
        });
        const quoteDecimals = Number(await this.publicClient.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
        const cost = parseUnits(position.costUsdc, quoteDecimals);
        if (hasReachedMultiple(amounts.at(-1)!, cost, this.config.autoSellAtMultiple)) {
          this.log("warning", `AUTO SELL: ${position.symbol} reached ${this.config.autoSellAtMultiple}x`);
          try { await this.sell(position.token); } catch (error) {
            this.log("error", `Auto sell failed for ${position.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        }
      } catch {
        // A transient quote failure is retried on the next monitor cycle.
      }
    }
  }

  private async onPair(token0?: Address, token1?: Address, pair?: Address): Promise<void> {
    if (!this.active || !token0 || !token1 || !pair) return;
    const quote = getAddress(this.config.quoteTokenAddress);
    if (!isAddressEqual(token0, quote) && !isAddressEqual(token1, quote)) return;
    const token = isAddressEqual(token0, quote) ? token1 : token0;
    if (this.config.targetTokenAddress && !isAddressEqual(token, getAddress(this.config.targetTokenAddress))) return;
    if (this.seen.has(pair.toLowerCase())) return;
    this.seen.add(pair.toLowerCase());
    this.log("info", `Pair detected: ${token.slice(0, 8)}...${token.slice(-6)}`);
    if (this.busy) {
      this.log("warning", "Skipped pair because another execution is active");
      return;
    }
    this.busy = true;
    try {
      await this.inspectAndBuy(token, pair);
    } catch (error) {
      this.log("error", error instanceof Error ? error.message : "Unknown execution error");
    } finally {
      this.busy = false;
    }
  }

  private async inspectAndBuy(token: Address, pair: Address): Promise<void> {
    const code = await this.publicClient.getBytecode({ address: token });
    this.audit("token_ca", "Token contract", code && code !== "0x" ? "pass" : "fail", token);
    if (!code || code === "0x") throw new Error("Token has no contract bytecode");

    const [nameResult, symbolResult, decimalsResult, supplyResult] = await Promise.allSettled([
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
    ]);
    const name = nameResult.status === "fulfilled" ? nameResult.value : "Unknown name";
    const symbol = symbolResult.status === "fulfilled" ? symbolResult.value : "TOKEN";
    const decimals = decimalsResult.status === "fulfilled" ? decimalsResult.value : 18;
    this.audit("token_identity", "Token identity", nameResult.status === "fulfilled" && symbolResult.status === "fulfilled" ? "pass" : "warning", `${name} (${symbol})`);
    if (supplyResult.status === "rejected" || supplyResult.value === 0n) {
      this.audit("token_supply", "Total supply", "fail", "Unreadable or zero");
      throw new Error("Token supply check failed");
    }
    this.audit("token_supply", "Total supply", "pass", formatUnits(supplyResult.value, decimals));

    const registeredPair = await this.publicClient.readContract({
      address: getAddress(this.config.factoryAddress),
      abi: factoryAbi,
      functionName: "getPair",
      args: [getAddress(this.config.quoteTokenAddress), token],
    });
    const pairAuthentic = isAddressEqual(registeredPair, pair);
    this.audit("pair_authenticity", "Factory pair", pairAuthentic ? "pass" : "fail", pairAuthentic ? pair : "Factory mismatch");
    if (!pairAuthentic) throw new Error("Pair does not match factory registry");

    const quoteDecimals = Number(await this.publicClient.readContract({
      address: getAddress(this.config.quoteTokenAddress), abi: erc20Abi, functionName: "decimals",
    }));
    const minLiquidity = parseUnits(this.config.minLiquidityUsdc, quoteDecimals);
    const quoteReserve = await this.waitForLiquidity(pair, minLiquidity);
    this.audit("liquidity", "USDC liquidity", "pass", `${formatUnits(quoteReserve, quoteDecimals)} USDC`);
    this.log("success", `${symbol} liquidity ready: ${formatUnits(quoteReserve, quoteDecimals)} USDC`);

    const amountIn = parseUnits(this.config.amountInUsdc, quoteDecimals);
    const path = [getAddress(this.config.quoteTokenAddress), token] as Address[];
    const amounts = await this.publicClient.readContract({
      address: getAddress(this.config.routerAddress),
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    });
    const quotedOut = amounts[amounts.length - 1];
    if (quotedOut <= 0n) throw new Error("Router returned a zero buy quote");
    this.audit("buy_route", "Buy route", "pass", `${this.config.amountInUsdc} USDC -> ${formatUnits(quotedOut, decimals)} ${symbol}`);
    const reverseProbe = quotedOut > 100n ? quotedOut / 100n : quotedOut;
    try {
      const sellAmounts = await this.publicClient.readContract({
        address: getAddress(this.config.routerAddress),
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [reverseProbe, [token, getAddress(this.config.quoteTokenAddress)]],
      });
      this.audit("sell_route", "Reverse sell quote", sellAmounts.at(-1)! > 0n ? "pass" : "fail", sellAmounts.at(-1)! > 0n ? "Route returns USDC" : "Zero output");
    } catch {
      this.audit("sell_route", "Reverse sell quote", "fail", "Router quote failed");
      throw new Error("Reverse sell route audit failed");
    }
    const amountOutMin = (quotedOut * BigInt(Math.floor((100 - this.config.slippagePercent) * 100))) / 10_000n;

    if (this.config.dryRun) {
      this.audit("simulation", "Transaction simulation", "warning", "Dry run quote only");
      this.log("success", `DRY RUN: would buy ${formatUnits(quotedOut, decimals)} ${symbol}`);
      return;
    }
    await this.executeBuy(token, symbol, decimals, amountIn, amountOutMin, path);
  }

  private async waitForLiquidity(pair: Address, minimum: bigint): Promise<bigint> {
    const quote = getAddress(this.config.quoteTokenAddress);
    for (let attempt = 0; attempt < 240 && this.active; attempt += 1) {
      try {
        const [reserves, token0] = await Promise.all([
          this.publicClient.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
          this.publicClient.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
        ]);
        const quoteReserve = isAddressEqual(token0, quote) ? reserves[0] : reserves[1];
        if (quoteReserve >= minimum) return quoteReserve;
      } catch {
        // Pair can exist one block before reserves are readable.
      }
      await sleep(this.config.pollMs);
    }
    throw new Error("Liquidity threshold was not reached within 60 seconds");
  }

  private async executeBuy(
    token: Address,
    symbol: string,
    decimals: number,
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
  ): Promise<void> {
    const account = privateKeyToAccount(this.privateKey!);
    const walletClient = createWalletClient({ account, chain: chains[this.config.network], transport: http(this.config.rpcHttp) });
    const quote = getAddress(this.config.quoteTokenAddress);
    const router = getAddress(this.config.routerAddress);
    const allowance = await this.publicClient.readContract({
      address: quote, abi: erc20Abi, functionName: "allowance", args: [account.address, router],
    });
    const quoteBalance = await this.publicClient.readContract({
      address: quote, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    });
    this.audit("wallet_balance", "Wallet USDC", quoteBalance >= amountIn ? "pass" : "fail", formatUnits(quoteBalance, 6));
    if (quoteBalance < amountIn) throw new Error("Wallet USDC balance is below the configured buy amount");
    if (allowance < amountIn) {
      this.log("info", "Approving router for USDC");
      const approval = await this.publicClient.simulateContract({
        account, address: quote, abi: erc20Abi, functionName: "approve", args: [router, maxUint256],
        maxFeePerGas: parseGwei(String(this.config.maxFeeGwei)),
        maxPriorityFeePerGas: parseGwei(String(this.config.priorityFeeGwei)),
      });
      const approvalHash = await walletClient.writeContract(approval.request);
      await this.publicClient.waitForTransactionReceipt({ hash: approvalHash });
    }

    const balanceBefore = await this.publicClient.readContract({
      address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    });
    const swap = await this.publicClient.simulateContract({
      account,
      address: router,
      abi: routerAbi,
      functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      args: [amountIn, amountOutMin, path, account.address, BigInt(Math.floor(Date.now() / 1000) + 60)],
      maxFeePerGas: parseGwei(String(this.config.maxFeeGwei)),
      maxPriorityFeePerGas: parseGwei(String(this.config.priorityFeeGwei)),
    });
    this.audit("simulation", "Transaction simulation", "pass", "Buy call passed eth_call");
    const buyHash = await walletClient.writeContract(swap.request);
    this.log("info", `Buy submitted for ${symbol}`, buyHash);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: buyHash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`Buy reverted: ${buyHash}`);
    const balanceAfter = await this.publicClient.readContract({
      address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    });
    const received = balanceAfter - balanceBefore;
    const position: Position = {
      network: this.config.network,
      token,
      symbol,
      amount: formatUnits(received, decimals),
      amountRaw: received.toString(),
      costUsdc: this.config.amountInUsdc,
      buyHash,
      openedAt: Date.now(),
    };
    this.positions.set(token.toLowerCase(), position);
    this.emit("position", position);
    this.log("success", `Bought ${position.amount} ${symbol}`, buyHash);
  }

  private log(level: ReactorEvent["level"], message: string, txHash?: string): void {
    const event: ReactorEvent = { id: crypto.randomUUID(), at: Date.now(), level, message, txHash };
    this.emit("event", event);
  }

  private audit(key: string, label: string, status: AuditItem["status"], value: string): void {
    this.emit("audit", { key, label, status, value } satisfies AuditItem);
  }
}
