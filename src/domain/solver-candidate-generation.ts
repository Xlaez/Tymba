import { Decimal } from "decimal.js";
import { MAX_PUBLIC_BUILDER_SEGMENTS } from "./curve.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import { DEFAULT_SOLVER_SEGMENT_COUNT } from "./solver-constants.js";

const ExactDecimal = Decimal.clone({
  precision: 512,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100_000,
  toExpPos: 100_000,
});

export function initialCandidateSegmentCount(
  maxSegments: number = DEFAULT_SOLVER_SEGMENT_COUNT,
): number {
  if (
    !Number.isInteger(maxSegments) ||
    maxSegments < 1 ||
    maxSegments > MAX_PUBLIC_BUILDER_SEGMENTS
  ) {
    throw new RangeError(
      `Maximum segments must be an integer from 1 to ${MAX_PUBLIC_BUILDER_SEGMENTS}`,
    );
  }
  return Math.min(DEFAULT_SOLVER_SEGMENT_COUNT, maxSegments);
}

export function generateInitialPriceBreakpoints(
  market: Pick<NormalizedMarketIntent, "startPrice" | "migrationPrice" | "maxSegments">,
): readonly Decimal[] {
  const segmentCount = initialCandidateSegmentCount(market.maxSegments);
  const startPrice = decimalValue(market.startPrice, "start price");
  const migrationPrice = decimalValue(market.migrationPrice, "migration price");
  if (!startPrice.isFinite() || !startPrice.gt(0)) {
    throw new RangeError("Start price must be finite and greater than zero");
  }
  if (!migrationPrice.isFinite() || !migrationPrice.gt(startPrice)) {
    throw new RangeError("Migration price must be greater than start price");
  }

  const priceSpan = migrationPrice.minus(startPrice);
  const boundaries: Decimal[] = [startPrice];
  let previous = startPrice;
  for (let index = 1; index < segmentCount; index += 1) {
    const offset = priceSpan.mul(index.toString()).div(segmentCount.toString());
    const boundary = startPrice.plus(offset);
    if (!boundary.gt(previous) || !boundary.lt(migrationPrice)) {
      throw new RangeError("Interior price boundaries are not distinct at solver precision");
    }
    boundaries.push(boundary);
    previous = boundary;
  }
  boundaries.push(migrationPrice);
  return boundaries;
}

function decimalValue(value: Decimal, field: string): Decimal {
  if (!Decimal.isDecimal(value))
    throw new TypeError(`${field} must be an arbitrary-precision decimal`);
  return new ExactDecimal(value.toFixed());
}
