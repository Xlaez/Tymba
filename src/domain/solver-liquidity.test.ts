import { describe, expect, it } from "vitest";
import { MAX_CURVE_U64 } from "./curve.js";
import { Q64_ONE } from "./price.js";
import {
  solveSegmentLiquidityForBaseTarget,
  solveSegmentLiquidityForQuoteTarget,
} from "./solver-liquidity.js";

const interval = {
  lowerSqrtPriceQ64x64: Q64_ONE,
  upperSqrtPriceQ64x64: 2n * Q64_ONE,
};

describe("solveSegmentLiquidityForQuoteTarget", () => {
  it("analytically recovers liquidity for an exactly representable quote target", () => {
    const result = solveSegmentLiquidityForQuoteTarget(interval, 4n);

    expect(result.liquidity).toBe(4n * Q64_ONE);
    expect(result.achievedAtomic).toBe(4n);
    expect(result.absoluteErrorAtomic).toBe(0n);
    expect(result.exact).toBe(true);
  });

  it("returns the closest protocol liquidity when the requested quote exceeds the representable range", () => {
    const result = solveSegmentLiquidityForQuoteTarget(
      { lowerSqrtPriceQ64x64: Q64_ONE, upperSqrtPriceQ64x64: Q64_ONE + 1n },
      2n,
    );

    expect(result.liquidity).toBe(1n);
    expect(result.achievedAtomic).toBe(1n);
    expect(result.absoluteErrorAtomic).toBe(1n);
    expect(result.exact).toBe(false);
  });

  it("rejects zero or out-of-range quote targets", () => {
    expect(() => solveSegmentLiquidityForQuoteTarget(interval, 0n)).toThrow(RangeError);
    expect(() => solveSegmentLiquidityForQuoteTarget(interval, MAX_CURVE_U64 + 1n)).toThrow(
      RangeError,
    );
  });
});

describe("solveSegmentLiquidityForBaseTarget", () => {
  it("analytically recovers liquidity for an exactly representable base target", () => {
    const result = solveSegmentLiquidityForBaseTarget(interval, 2n);

    expect(result.liquidity).toBe(4n * Q64_ONE);
    expect(result.achievedAtomic).toBe(2n);
    expect(result.absoluteErrorAtomic).toBe(0n);
    expect(result.exact).toBe(true);
  });

  it("supports a zero-base target while keeping protocol liquidity positive", () => {
    const result = solveSegmentLiquidityForBaseTarget(interval, 0n);

    expect(result.liquidity).toBe(1n);
    expect(result.achievedAtomic).toBe(0n);
    expect(result.exact).toBe(true);
  });

  it("reports the closest attainable base amount at the liquidity limit", () => {
    const result = solveSegmentLiquidityForBaseTarget(
      { lowerSqrtPriceQ64x64: Q64_ONE, upperSqrtPriceQ64x64: Q64_ONE + 1n },
      1n,
    );

    expect(result.liquidity).toBe(1n);
    expect(result.achievedAtomic).toBe(0n);
    expect(result.absoluteErrorAtomic).toBe(1n);
    expect(result.exact).toBe(false);
  });

  it("rejects out-of-range base targets", () => {
    expect(() => solveSegmentLiquidityForBaseTarget(interval, MAX_CURVE_U64 + 1n)).toThrow(
      RangeError,
    );
  });
});
