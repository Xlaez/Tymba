import { validateLPPercentages } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { describe, expect, it } from "vitest";
import { MAX_CURVE_U128 } from "./curve.js";
import type { LiquidityAllocation } from "./migration.js";
import { calculatePostMigrationLiquidityAllocation } from "./migration-allocation.js";

const allocation: LiquidityAllocation = {
  creator: { unlockedBps: 5_500n, permanentlyLockedBps: 1_000n, vestingBps: 500n },
  partner: { unlockedBps: 1_500n, permanentlyLockedBps: 1_000n, vestingBps: 500n },
};

describe("post-migration DAMM liquidity allocation", () => {
  it("matches the program bucket floors and assigns all rounding remainder to creator unlocked", () => {
    expect(calculatePostMigrationLiquidityAllocation(11n, allocation)).toEqual({
      distributableLiquidity: 11n,
      creator: { unlocked: 8n, permanentlyLocked: 1n, vesting: 0n },
      partner: { unlocked: 1n, permanentlyLocked: 1n, vesting: 0n },
    });
  });

  it("maps BPS shares to the pinned SDK's percentage validation", () => {
    expect(
      validateLPPercentages(
        Number(allocation.partner.unlockedBps / 100n),
        Number(allocation.partner.permanentlyLockedBps / 100n),
        Number(allocation.creator.unlockedBps / 100n),
        Number(allocation.creator.permanentlyLockedBps / 100n),
        Number(allocation.partner.vestingBps / 100n),
        Number(allocation.creator.vestingBps / 100n),
      ),
    ).toBe(true);

    expect(
      calculatePostMigrationLiquidityAllocation(MAX_CURVE_U128, {
        creator: { unlockedBps: 10_000n, permanentlyLockedBps: 0n, vestingBps: 0n },
        partner: { unlockedBps: 0n, permanentlyLockedBps: 0n, vestingBps: 0n },
      }),
    ).toEqual({
      distributableLiquidity: MAX_CURVE_U128,
      creator: { unlocked: MAX_CURVE_U128, permanentlyLocked: 0n, vesting: 0n },
      partner: { unlocked: 0n, permanentlyLocked: 0n, vesting: 0n },
    });
  });

  it("conserves liquidity across generated allocations and amounts", () => {
    for (let creatorUnlocked = 0n; creatorUnlocked <= 10_000n; creatorUnlocked += 1_000n) {
      const remaining = 10_000n - creatorUnlocked;
      const generatedAllocation: LiquidityAllocation = {
        creator: { unlockedBps: creatorUnlocked, permanentlyLockedBps: 0n, vestingBps: 0n },
        partner: { unlockedBps: remaining, permanentlyLockedBps: 0n, vestingBps: 0n },
      };

      for (const total of [0n, 1n, 99n, MAX_CURVE_U128]) {
        const result = calculatePostMigrationLiquidityAllocation(total, generatedAllocation);
        const sum =
          result.creator.unlocked +
          result.creator.permanentlyLocked +
          result.creator.vesting +
          result.partner.unlocked +
          result.partner.permanentlyLocked +
          result.partner.vesting;

        expect(sum).toBe(total);
      }
    }
  });

  it("rejects invalid liquidity values and allocation percentages", () => {
    expect(() => calculatePostMigrationLiquidityAllocation(-1n, allocation)).toThrow(RangeError);
    expect(() =>
      calculatePostMigrationLiquidityAllocation(MAX_CURVE_U128 + 1n, allocation),
    ).toThrow(RangeError);
    expect(() =>
      calculatePostMigrationLiquidityAllocation(100n, {
        ...allocation,
        partner: { ...allocation.partner, unlockedBps: 1_600n },
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculatePostMigrationLiquidityAllocation(100n, {
        ...allocation,
        creator: { ...allocation.creator, unlockedBps: 5_501n },
      }),
    ).toThrow("whole percentages");
  });
});
