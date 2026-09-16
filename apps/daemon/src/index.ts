import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { validateConfig } from "../../desktop/src/main/config";
import { SniperEngine } from "../../desktop/src/main/sniper";
import type { AuditItem, Position, ReactorEvent } from "../../desktop/src/main/types";

const command = process.argv[2] || "start";
const configPath = process.env.REACTOR_CONFIG_PATH || "/etc/reactor-bot/config.json";
const positionsPath = process.env.REACTOR_POSITIONS_PATH || "/var/lib/reactor-bot/positions.json";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadPositions(): Promise<Position[]> {
  try {
    const value = await readJson(positionsPath);
    return Array.isArray(value) ? value as Position[] : [];
  } catch {
    return [];
  }
}

async function savePositions(positions: Position[]): Promise<void> {
  await mkdir(path.dirname(positionsPath), { recursive: true });
  const temporary = `${positionsPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(positions, null, 2), { mode: 0o600 });
  await rename(temporary, positionsPath);
}

function eventLine(event: ReactorEvent): string {
  const transaction = event.txHash ? ` tx=${event.txHash}` : "";
  return `${new Date(event.at).toISOString()} [${event.level.toUpperCase()}] ${event.message}${transaction}`;
}

async function main(): Promise<void> {
  const config = validateConfig(await readJson(configPath));
  if (command === "check-config") {
    console.log(`Configuration valid for Arc ${config.network}.`);
    return;
  }
  if (command !== "start") throw new Error("Use start or check-config");

  const rawKey = process.env.REACTOR_PRIVATE_KEY?.trim();
  const privateKey = rawKey && /^0x[a-fA-F0-9]{64}$/.test(rawKey) ? rawKey as `0x${string}` : undefined;
  const walletAddress = privateKey ? privateKeyToAccount(privateKey).address : null;
  if (!config.dryRun && !privateKey) throw new Error("Live mode requires REACTOR_PRIVATE_KEY in /etc/reactor-bot.env");

  let positions = await loadPositions();
  const engine = new SniperEngine(config, privateKey, walletAddress, positions);
  engine.on("event", (event: ReactorEvent) => console.log(eventLine(event)));
  engine.on("audit", (audit: AuditItem) => console.log(`${new Date().toISOString()} [AUDIT:${audit.status.toUpperCase()}] ${audit.label}: ${audit.value}`));
  engine.on("position", (position: Position) => {
    positions = [position, ...positions.filter((item) => item.token.toLowerCase() !== position.token.toLowerCase())];
    void savePositions(positions);
  });
  engine.on("position-closed", (token: string) => {
    positions = positions.filter((position) => position.token.toLowerCase() !== token.toLowerCase());
    void savePositions(positions);
  });

  const stop = () => {
    engine.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await engine.start();
  console.log(`${new Date().toISOString()} REACTOR daemon ready. wallet=${walletAddress ?? "dry-run"}`);
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} [FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
