import { describe, expect, it } from "vitest";
import { normalizeSolverInput } from "./solver-input.js";

const marketIntent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startFdv: "200000", migrationFdv: "2000000" },
  targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
  preferences: { launchProfile: "balanced", maxEarlyPriceImpactPct: "12.5" },
  solver: { maxSegments: 3 },
  migration: {
    creatorLockedPct: "20",
    partnerLockedPct: "20",
    unlockedPct: "60",
    lockDurationSeconds: "86400",
  },
};

const feeConfiguration = {
  base: { kind: "fixed", feeBps: 100n },
  collectFeeMode: "quote",
  creatorTradingFeeShareBps: 2_500n,
} as const;

const migrationConfiguration = {
  destination: "damm-v2",
  allocationIntent: {
    creatorLockedBps: 1_000n,
    partnerLockedBps: 1_000n,
    unlockedBps: 8_000n,
    lockDurationSeconds: 86_400n,
  },
} as const;

describe("normalizeSolverInput", () => {
  it("normalizes economic intent and validates fee and migration configurations together", () => {
    const result = normalizeSolverInput({
      marketIntent,
      feeConfiguration,
      migrationConfiguration,
    });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.normalized.market.startPrice.toString()).toBe("0.0002");
    expect(result.normalized.market.startFdv.toString()).toBe("200000");
    expect(result.normalized.market.totalBaseAtomic).toBe(1_000_000_000_000_000_000n);
    expect(result.normalized.market.quoteToMigrationAtomic).toBe(150_000_000_000n);
    expect(result.normalized.market.targetBaseDistributionBps).toBe(2_500n);
    expect(result.normalized.market.maxEarlyPriceImpactBps).toBe(1_250n);
    expect(result.normalized.market.migration?.creatorLockedBps).toBe(2_000n);
    expect(result.normalized.fees).toEqual(feeConfiguration);
    expect(result.normalized.migrationConfiguration).toEqual(migrationConfiguration);
  });

  it("preserves omitted fee and migration configurations instead of inventing defaults", () => {
    const result = normalizeSolverInput({ marketIntent });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.normalized.fees).toBeUndefined();
    expect(result.normalized.migrationConfiguration).toBeUndefined();
  });

  it("rejects invalid market and configuration fields with source paths", () => {
    const result = normalizeSolverInput({
      marketIntent: { ...marketIntent, supply: { totalBase: 1_000_000_000 } },
      feeConfiguration: { ...feeConfiguration, creatorTradingFeeShareBps: 250n },
      migrationConfiguration: { destination: "unsupported" },
    });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.marketIntent.supply.totalBase" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.feeConfiguration.creatorTradingFeeShareBps" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.migrationConfiguration.destination" }),
    );
  });

  it("rejects unknown wrapper fields", () => {
    const result = normalizeSolverInput({ marketIntent, ignored: true });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.ignored", code: "unknown_field" }),
    );
  });
});
