import { describe, expect, it } from "vitest";
import { validateMarketIntent, type MarketIntent } from "./market-intent.js";

const demoIntent: MarketIntent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startFdv: "200000", migrationFdv: "2000000" },
  targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
  preferences: { launchProfile: "balanced", sniperResistance: "high" },
  solver: { maxSegments: 3 },
};

describe("validateMarketIntent", () => {
  it("normalizes the canonical demo fixture without floating-point amounts", () => {
    const result = validateMarketIntent(demoIntent);

    expect(result.status).toBe("valid");
    if (result.status === "invalid") return;
    expect(result.normalized.totalBaseAtomic).toBe(1_000_000_000_000_000_000n);
    expect(result.normalized.quoteToMigrationAtomic).toBe(150_000_000_000n);
    expect(result.normalized.startPrice.toString()).toBe("0.0002");
    expect(result.normalized.migrationPrice.toString()).toBe("0.002");
    expect(result.normalized.targetBaseDistributionBps).toBe(2_500n);
    expect(result.normalized.maxSegments).toBe(3);
  });

  it("derives FDV from a supplied price", () => {
    const result = validateMarketIntent({
      ...demoIntent,
      pricing: { startPrice: "0.0002", migrationPrice: "0.002" },
    });

    expect(result.status).toBe("valid");
    if (result.status === "invalid") return;
    expect(result.normalized.startFdv.toString()).toBe("200000");
    expect(result.normalized.migrationFdv.toString()).toBe("2000000");
  });

  it("accepts consistent supplied price and FDV pairs", () => {
    const result = validateMarketIntent({
      ...demoIntent,
      pricing: {
        startPrice: "0.0002",
        startFdv: "200000",
        migrationPrice: "0.002",
        migrationFdv: "2000000",
      },
    });

    expect(result.status).toBe("valid");
  });

  it("rejects inconsistent supplied price and FDV pairs", () => {
    const result = validateMarketIntent({
      ...demoIntent,
      pricing: { startPrice: "0.0003", startFdv: "200000", migrationFdv: "2000000" },
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.pricing.startPrice", code: "inconsistent_pair" }),
    );
  });

  it("rejects missing price alternatives and non-decimal number inputs", () => {
    const missing = validateMarketIntent({ ...demoIntent, pricing: {} });
    const numberInput = validateMarketIntent({
      ...demoIntent,
      pricing: { startFdv: 200000, migrationFdv: "2000000" },
    });

    expect(missing.status).toBe("invalid");
    expect(numberInput.status).toBe("invalid");
  });

  it("rejects amounts that exceed asset precision and percentages that are not basis points", () => {
    const quotePrecision = validateMarketIntent({
      ...demoIntent,
      targets: { quoteToMigration: "1.0000001" },
    });
    const percentagePrecision = validateMarketIntent({
      ...demoIntent,
      targets: { baseDistributionPct: "25.001" },
    });

    expect(quotePrecision.status).toBe("invalid");
    expect(percentagePrecision.status).toBe("invalid");
  });

  it("validates migration allocation sums, minimum locked allocation, and duration", () => {
    const invalidAllocation = validateMarketIntent({
      ...demoIntent,
      migration: {
        creatorLockedPct: "5",
        partnerLockedPct: "0",
        unlockedPct: "95",
        lockDurationSeconds: "63072001",
      },
    });

    expect(invalidAllocation.status).toBe("invalid");
    if (invalidAllocation.status === "valid") return;
    expect(invalidAllocation.issues.map((issue) => issue.code)).toContain(
      "minimum_locked_allocation",
    );
    expect(invalidAllocation.issues.map((issue) => issue.code)).toContain("out_of_range");
  });

  it("accepts 16 segments and rejects higher limits", () => {
    const atLimit = validateMarketIntent({ ...demoIntent, solver: { maxSegments: 16 } });
    const result = validateMarketIntent({
      ...demoIntent,
      solver: { maxSegments: 17 },
      extra: true,
    });

    expect(atLimit.status).toBe("valid");
    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    expect(result.issues.map((issue) => issue.code)).toContain("unknown_field");
    expect(result.issues.map((issue) => issue.code)).toContain("out_of_range");
  });
});
