import { describe, expect, it } from "vitest";
import {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "./configuration-validation.js";

const validFeeConfiguration = {
  base: {
    kind: "linear",
    startingFeeBps: 1_000n,
    endingFeeBps: 100n,
    periodCount: 5n,
    periodFrequency: 60n,
    clock: "timestamp",
  },
  dynamic: {
    binStepBps: 1n,
    filterPeriodSeconds: 10n,
    decayPeriodSeconds: 120n,
    reductionFactorBps: 5_000n,
    maxVolatilityAccumulator: 100_000n,
    variableFeeControl: 1_000n,
  },
  collectFeeMode: "quote",
  creatorTradingFeeShareBps: 2_000n,
  migratedPool: {
    feeBps: 100n,
    collectFeeMode: "compounding",
    dynamicFeeEnabled: false,
    compoundingFeeBps: 500n,
  },
} as const;

const validLiquidityAllocation = {
  creator: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
  partner: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
} as const;

const validMigrationConfiguration = {
  destination: "damm-v2",
  fee: { feeBps: 1_000n, creatorFeeShareBps: 5_000n },
  allocationIntent: {
    creatorLockedBps: 500n,
    partnerLockedBps: 500n,
    unlockedBps: 9_000n,
    lockDurationSeconds: 63_072_000n,
  },
  liquidityAllocation: validLiquidityAllocation,
  migratedPoolFee: {
    feeBps: 100n,
    collectFeeMode: "compounding",
    dynamicFeeEnabled: false,
    compoundingFeeBps: 500n,
  },
} as const;

describe("validateFeeConfiguration", () => {
  it("accepts supported scheduled, dynamic, and migrated-pool fee settings", () => {
    const result = validateFeeConfiguration(validFeeConfiguration);

    expect(result).toEqual({ status: "valid", value: validFeeConfiguration });
  });

  it("rejects unsupported fee amounts, schedule bounds, and dynamic periods", () => {
    const result = validateFeeConfiguration({
      ...validFeeConfiguration,
      base: {
        ...validFeeConfiguration.base,
        startingFeeBps: 24n,
        periodCount: 65_536n,
        periodFrequency: 0n,
      },
      dynamic: {
        ...validFeeConfiguration.dynamic,
        filterPeriodSeconds: 120n,
        decayPeriodSeconds: 120n,
        variableFeeControl: 1n << 24n,
      },
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("out_of_range");
    expect(codes).toContain("invalid_period_order");
  });

  it("requires compounding-fee settings only for compounding mode", () => {
    const missing = validateFeeConfiguration({
      ...validFeeConfiguration,
      migratedPool: {
        feeBps: 100n,
        collectFeeMode: "compounding",
        dynamicFeeEnabled: false,
      },
    });
    const unexpected = validateFeeConfiguration({
      ...validFeeConfiguration,
      migratedPool: {
        feeBps: 100n,
        collectFeeMode: "quote",
        dynamicFeeEnabled: false,
        compoundingFeeBps: 500n,
      },
    });

    expect(missing.status).toBe("invalid");
    expect(unexpected.status).toBe("invalid");
  });
});

describe("validateMigrationConfiguration", () => {
  it("accepts whole-percent migration fees and six liquidity buckets totaling 100%", () => {
    const result = validateMigrationConfiguration(validMigrationConfiguration);

    expect(result).toEqual({ status: "valid", value: validMigrationConfiguration });
  });

  it("rejects fractional SDK percentages, invalid fee splits, and bad allocation totals", () => {
    const result = validateMigrationConfiguration({
      ...validMigrationConfiguration,
      fee: { feeBps: 250n, creatorFeeShareBps: 5_000n },
      liquidityAllocation: {
        creator: { unlockedBps: 2_050n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
        partner: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
      },
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("unsupported_precision");
    expect(codes).toContain("allocation_sum");
  });

  it("rejects creator migration share when no migration fee is charged", () => {
    const result = validateMigrationConfiguration({
      destination: "damm-v2",
      fee: { feeBps: 0n, creatorFeeShareBps: 1_000n },
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "$.fee.creatorFeeShareBps",
        code: "creator_share_without_fee",
      }),
    );
  });

  it("enforces allocation-intent sum, minimum locked intent, and lock duration", () => {
    const result = validateMigrationConfiguration({
      destination: "damm-v2",
      allocationIntent: {
        creatorLockedBps: 100n,
        partnerLockedBps: 100n,
        unlockedBps: 9_000n,
        lockDurationSeconds: 63_072_001n,
      },
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("allocation_sum");
    expect(codes).toContain("minimum_locked_allocation");
    expect(codes).toContain("out_of_range");
  });
});
