import { fromDecimalToBN, getMigrationThresholdPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import type { CurveSegment, DbcCurve } from "./curve.js";
import { MAX_CURVE_U64 } from "./curve.js";
import {
  calculateMigrationQuoteAccounting,
  migrationSqrtPriceAtThreshold,
} from "./migration-math.js";
import { Q64_ONE } from "./price.js";

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

const segments: readonly CurveSegment[] = [
  {
    lowerSqrtPriceQ64x64: Q64_ONE,
    upperSqrtPriceQ64x64: 2n * Q64_ONE,
    liquidity: 2n * Q64_ONE,
  },
  {
    lowerSqrtPriceQ64x64: 2n * Q64_ONE,
    upperSqrtPriceQ64x64: 3n * Q64_ONE,
    liquidity: 12n * Q64_ONE,
  },
];

function curveWithThreshold(migrationQuoteThresholdAtomic: bigint): DbcCurve {
  return {
    baseDecimals: 9,
    quoteDecimals: 6,
    startSqrtPriceQ64x64: Q64_ONE,
    migrationQuoteThresholdAtomic,
    segments,
  };
}

describe("migration price at the quote threshold", () => {
  it("matches the pinned SDK inside a segment and at exact boundaries", () => {
    for (const threshold of [2n, 5n, 14n]) {
      const curve = curveWithThreshold(threshold);
      const sdkPrice = getMigrationThresholdPrice(
        sdkInteger(threshold),
        sdkInteger(curve.startSqrtPriceQ64x64),
        segments.map((segment) => ({
          sqrtPrice: sdkInteger(segment.upperSqrtPriceQ64x64),
          liquidity: sdkInteger(segment.liquidity),
        })),
      );

      expect(migrationSqrtPriceAtThreshold(curve).toString()).toBe(sdkPrice.toString());
    }
  });

  it("rejects thresholds beyond the available curve liquidity", () => {
    expect(() => migrationSqrtPriceAtThreshold(curveWithThreshold(15n))).toThrow(RangeError);
  });
});

describe("migration progress, overshoot, and surplus", () => {
  it("calculates bounded progress before completion", () => {
    expect(calculateMigrationQuoteAccounting(25n, 100n)).toEqual({
      quoteReserveAtomic: 25n,
      thresholdAtomic: 100n,
      progressBps: 2_500n,
      curveComplete: false,
      overshootAtomic: 0n,
      surplus: { partnerCreatorAtomic: 0n, protocolAtomic: 0n },
    });
    expect(calculateMigrationQuoteAccounting(99n, 100n).progressBps).toBe(9_900n);
  });

  it("marks threshold completion and allocates only the verified aggregate surplus shares", () => {
    const atThreshold = calculateMigrationQuoteAccounting(100n, 100n);
    const afterOvershoot = calculateMigrationQuoteAccounting(107n, 100n);

    expect(atThreshold.curveComplete).toBe(true);
    expect(atThreshold.progressBps).toBe(10_000n);
    expect(atThreshold.overshootAtomic).toBe(0n);
    expect(afterOvershoot).toMatchObject({
      curveComplete: true,
      progressBps: 10_000n,
      overshootAtomic: 7n,
      surplus: { partnerCreatorAtomic: 5n, protocolAtomic: 2n },
    });
    expect(calculateMigrationQuoteAccounting(101n, 100n).surplus).toEqual({
      partnerCreatorAtomic: 0n,
      protocolAtomic: 1n,
    });
  });

  it("rejects invalid quote reserves and thresholds", () => {
    expect(() => calculateMigrationQuoteAccounting(-1n, 100n)).toThrow(RangeError);
    expect(() => calculateMigrationQuoteAccounting(0n, 0n)).toThrow(RangeError);
    expect(() => calculateMigrationQuoteAccounting(0n, MAX_CURVE_U64 + 1n)).toThrow(RangeError);
  });
});
