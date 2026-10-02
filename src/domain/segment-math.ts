import {
  type CurveSegment,
  MAX_CURVE_U64,
  MAX_CURVE_U128,
  MAX_PUBLIC_BUILDER_SEGMENTS,
} from "./curve.js";
import { Q128_SCALE } from "./price.js";

export function quoteRequiredForSegment(segment: CurveSegment): bigint {
  validateSegment(segment);
  const numerator =
    segment.liquidity * (segment.upperSqrtPriceQ64x64 - segment.lowerSqrtPriceQ64x64);
  return divideRoundUp(numerator, Q128_SCALE);
}

export function baseDistributedForSegment(segment: CurveSegment): bigint {
  validateSegment(segment);
  const numerator =
    segment.liquidity * (segment.upperSqrtPriceQ64x64 - segment.lowerSqrtPriceQ64x64);
  const denominator = segment.lowerSqrtPriceQ64x64 * segment.upperSqrtPriceQ64x64;
  return numerator / denominator;
}

export function baseRequiredForSegment(segment: CurveSegment): bigint {
  validateSegment(segment);
  const numerator =
    segment.liquidity * (segment.upperSqrtPriceQ64x64 - segment.lowerSqrtPriceQ64x64);
  const denominator = segment.lowerSqrtPriceQ64x64 * segment.upperSqrtPriceQ64x64;
  return divideRoundUp(numerator, denominator);
}

export function quoteDistributedForSegment(segment: CurveSegment): bigint {
  validateSegment(segment);
  const numerator =
    segment.liquidity * (segment.upperSqrtPriceQ64x64 - segment.lowerSqrtPriceQ64x64);
  return numerator / Q128_SCALE;
}

export function quoteRequiredForSegments(segments: readonly CurveSegment[]): bigint {
  validateSegmentSequence(segments);
  return segments.reduce((total, segment) => total + quoteRequiredForSegment(segment), 0n);
}

export function baseDistributedForSegments(segments: readonly CurveSegment[]): bigint {
  validateSegmentSequence(segments);
  return segments.reduce((total, segment) => total + baseDistributedForSegment(segment), 0n);
}

export function sqrtPriceAfterQuoteInput(
  sqrtPriceQ64x64: bigint,
  liquidity: bigint,
  quoteAmountAtomic: bigint,
): bigint {
  validatePriceAndLiquidity(sqrtPriceQ64x64, liquidity);
  validateAmount(quoteAmountAtomic);
  const nextSqrtPrice = sqrtPriceQ64x64 + (quoteAmountAtomic * Q128_SCALE) / liquidity;
  return validateNextSqrtPrice(nextSqrtPrice);
}

export function sqrtPriceAfterBaseOutput(
  sqrtPriceQ64x64: bigint,
  liquidity: bigint,
  baseAmountAtomic: bigint,
): bigint {
  validatePriceAndLiquidity(sqrtPriceQ64x64, liquidity);
  validateAmount(baseAmountAtomic);
  if (baseAmountAtomic === 0n) return sqrtPriceQ64x64;
  const denominator = liquidity - baseAmountAtomic * sqrtPriceQ64x64;
  if (denominator <= 0n) {
    throw new RangeError("Base output must be less than liquidity divided by sqrt price");
  }
  const numerator = liquidity * sqrtPriceQ64x64;
  return validateNextSqrtPrice(divideRoundUp(numerator, denominator));
}

export function sqrtPriceAfterBaseInput(
  sqrtPriceQ64x64: bigint,
  liquidity: bigint,
  baseAmountAtomic: bigint,
): bigint {
  validatePriceAndLiquidity(sqrtPriceQ64x64, liquidity);
  validateAmount(baseAmountAtomic);
  if (baseAmountAtomic === 0n) return sqrtPriceQ64x64;
  const product = baseAmountAtomic * sqrtPriceQ64x64;
  if (product > MAX_CURVE_U128) {
    const denominator = liquidity / sqrtPriceQ64x64 + baseAmountAtomic;
    return validateNextSqrtPrice(liquidity / denominator);
  }
  const numerator = liquidity * sqrtPriceQ64x64;
  return validateNextSqrtPrice(divideRoundUp(numerator, liquidity + product));
}

export function sqrtPriceAfterQuoteOutput(
  sqrtPriceQ64x64: bigint,
  liquidity: bigint,
  quoteAmountAtomic: bigint,
): bigint {
  validatePriceAndLiquidity(sqrtPriceQ64x64, liquidity);
  validateAmount(quoteAmountAtomic);
  const amountInSqrtPriceUnits = divideRoundUp(quoteAmountAtomic * Q128_SCALE, liquidity);
  const nextSqrtPrice = sqrtPriceQ64x64 - amountInSqrtPriceUnits;
  return validateNextSqrtPrice(nextSqrtPrice);
}

function validateSegment(segment: CurveSegment): void {
  validateSqrtPrice(segment.lowerSqrtPriceQ64x64, "Lower sqrt price");
  if (
    typeof segment.upperSqrtPriceQ64x64 !== "bigint" ||
    segment.upperSqrtPriceQ64x64 <= segment.lowerSqrtPriceQ64x64
  ) {
    throw new RangeError("Upper sqrt price must be a greater u128 value than the lower sqrt price");
  }
  validateSqrtPrice(segment.upperSqrtPriceQ64x64, "Upper sqrt price");
  if (
    typeof segment.liquidity !== "bigint" ||
    segment.liquidity <= 0n ||
    segment.liquidity > MAX_CURVE_U128
  ) {
    throw new RangeError("Liquidity must be a positive u128 value");
  }
}

function validateSegmentSequence(segments: readonly CurveSegment[]): void {
  if (
    !Array.isArray(segments) ||
    segments.length < 1 ||
    segments.length > MAX_PUBLIC_BUILDER_SEGMENTS
  ) {
    throw new RangeError(
      `Segments must contain between 1 and ${MAX_PUBLIC_BUILDER_SEGMENTS} items`,
    );
  }

  let previousUpperSqrtPriceQ64x64: bigint | undefined;
  for (const segment of segments) {
    validateSegment(segment);
    if (
      previousUpperSqrtPriceQ64x64 !== undefined &&
      segment.lowerSqrtPriceQ64x64 !== previousUpperSqrtPriceQ64x64
    ) {
      throw new RangeError("Segments must be contiguous and ordered by increasing sqrt price");
    }
    previousUpperSqrtPriceQ64x64 = segment.upperSqrtPriceQ64x64;
  }
}

function validatePriceAndLiquidity(sqrtPriceQ64x64: bigint, liquidity: bigint): void {
  validateSqrtPrice(sqrtPriceQ64x64, "Sqrt price");
  if (typeof liquidity !== "bigint" || liquidity <= 0n || liquidity > MAX_CURVE_U128) {
    throw new RangeError("Liquidity must be a positive u128 value");
  }
}

function validateSqrtPrice(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_CURVE_U128) {
    throw new RangeError(`${label} must be a positive u128 value`);
  }
}

function validateAmount(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_CURVE_U64) {
    throw new RangeError("Atomic amount must be a non-negative u64 bigint");
  }
}

function validateNextSqrtPrice(value: bigint): bigint {
  validateSqrtPrice(value, "Next sqrt price");
  return value;
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
