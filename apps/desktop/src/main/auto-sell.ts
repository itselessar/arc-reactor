import type { AutoSellTimeUnit } from "./types";

const UNIT_MS: Record<AutoSellTimeUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function getAutoSellDeadline(openedAt: number, value: number, unit: AutoSellTimeUnit): number {
  return openedAt + value * UNIT_MS[unit];
}

export function hasReachedMultiple(currentValue: bigint, entryCost: bigint, multiple: number): boolean {
  if (multiple <= 0 || entryCost <= 0n) return false;
  const targetBasisPoints = BigInt(Math.round(multiple * 10_000));
  return currentValue * 10_000n >= entryCost * targetBasisPoints;
}
