import type { CurveSegment } from "./curve.js";
import { MAX_CURVE_U128, MAX_CURVE_U64 } from "./curve.js";
import { baseDistributedForSegment, quoteRequiredForSegment } from "./segment-math.js";
import { Q128_SCALE } from "./price.js";

export type SegmentLiquiditySolution = Readonly<{
  liquidity: bigint;
  targetAtomic: bigint;
  achievedAtomic: bigint;
  absoluteErrorAtomic: bigint;
  exact: boolean;
}>;

type SegmentPriceInterval = Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">;

export function solveSegmentLiquidityForQuoteTarget(
  interval: SegmentPriceInterval,
  targetQuoteAtomic: bigint,
): SegmentLiquiditySolution {
  validateTarget(targetQuoteAtomic, false);
  const segment = { ...interval, liquidity: 1n };
  quoteRequiredForSegment(segment);
  const priceDelta = interval.upperSqrtPriceQ64x64 - interval.lowerSqrtPriceQ64x64;
  return solveNearestLiquidity(
    targetQuoteAtomic,
    (liquidity) => quoteRequiredForSegment({ ...interval, liquidity }),
    targetQuoteAtomic * Q128_SCALE,
    priceDelta,
  );
}

export function solveSegmentLiquidityForBaseTarget(
  interval: SegmentPriceInterval,
  targetBaseAtomic: bigint,
): SegmentLiquiditySolution {
  validateTarget(targetBaseAtomic, true);
  const segment = { ...interval, liquidity: 1n };
  baseDistributedForSegment(segment);
  const priceDelta = interval.upperSqrtPriceQ64x64 - interval.lowerSqrtPriceQ64x64;
  const denominator = interval.lowerSqrtPriceQ64x64 * interval.upperSqrtPriceQ64x64;
  return solveNearestLiquidity(
    targetBaseAtomic,
    (liquidity) => baseDistributedForSegment({ ...interval, liquidity }),
    targetBaseAtomic * denominator,
    priceDelta,
  );
}

function solveNearestLiquidity(
  targetAtomic: bigint,
  measure: (liquidity: bigint) => bigint,
  inverseNumerator: bigint,
  inverseDenominator: bigint,
): SegmentLiquiditySolution {
  const floorEstimate = inverseNumerator / inverseDenominator;
  const ceilEstimate = divideRoundUp(inverseNumerator, inverseDenominator);
  const candidates = new Set([
    clampLiquidity(floorEstimate),
    clampLiquidity(ceilEstimate),
    1n,
    MAX_CURVE_U128,
  ]);
  let best: SegmentLiquiditySolution | undefined;

  for (const liquidity of candidates) {
    const achievedAtomic = measure(liquidity);
    const absoluteErrorAtomic = absoluteDifference(achievedAtomic, targetAtomic);
    if (
      best === undefined ||
      absoluteErrorAtomic < best.absoluteErrorAtomic ||
      (absoluteErrorAtomic === best.absoluteErrorAtomic && liquidity < best.liquidity)
    ) {
      best = {
        liquidity,
        targetAtomic,
        achievedAtomic,
        absoluteErrorAtomic,
        exact: absoluteErrorAtomic === 0n,
      };
    }
  }

  if (!best) throw new Error("At least one liquidity candidate is required");
  return best;
}

function validateTarget(targetAtomic: bigint, allowZero: boolean): void {
  if (
    typeof targetAtomic !== "bigint" ||
    targetAtomic < (allowZero ? 0n : 1n) ||
    targetAtomic > MAX_CURVE_U64
  ) {
    const lowerBound = allowZero ? "non-negative" : "positive";
    throw new RangeError(`Target amount must be a ${lowerBound} u64 bigint`);
  }
}

function clampLiquidity(liquidity: bigint): bigint {
  if (liquidity < 1n) return 1n;
  if (liquidity > MAX_CURVE_U128) return MAX_CURVE_U128;
  return liquidity;
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}
