import { Decimal } from "decimal.js";
import type { DbcCurve, CurveShapeIssue, CurveSegment } from "./curve.js";
import {
  MAX_CURVE_U128,
  MAX_CURVE_U64,
  MAX_PUBLIC_BUILDER_SEGMENTS,
  validateDbcCurveShape,
} from "./curve.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import { baseDistributedForSegments, quoteRequiredForSegments } from "./segment-math.js";
import { priceToSqrtPriceQ64x64 } from "./price.js";
import type { ValidationStatus } from "./status.js";

export type CandidateCurveIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type CandidateCurveValidationResult =
  | Readonly<{
      status: Extract<ValidationStatus, "valid">;
      curve: DbcCurve;
      quoteCapacityAtomic: bigint;
      baseDistributedAtomic: bigint;
    }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly CandidateCurveIssue[];
    }>;

export type CandidateCurveDraft = Readonly<{
  market: NormalizedMarketIntent;
  priceBreakpoints: readonly Decimal[];
  segmentLiquidities: readonly bigint[];
  migrationQuoteThresholdAtomic: bigint;
}>;

export function validateCandidateCurve(input: CandidateCurveDraft): CandidateCurveValidationResult {
  const issues: CandidateCurveIssue[] = [];
  if (!Array.isArray(input.priceBreakpoints)) {
    return invalid("$.priceBreakpoints", "invalid_array", "Expected an array of price boundaries");
  }
  if (!Array.isArray(input.segmentLiquidities)) {
    return invalid(
      "$.segmentLiquidities",
      "invalid_array",
      "Expected an array of segment liquidity values",
    );
  }

  const segmentCount = input.segmentLiquidities.length;
  if (
    !Number.isInteger(input.market.maxSegments) ||
    input.market.maxSegments < 1 ||
    input.market.maxSegments > MAX_PUBLIC_BUILDER_SEGMENTS
  ) {
    issues.push({
      path: "$.market.maxSegments",
      code: "invalid_segment_limit",
      message: `Maximum segments must be an integer from 1 to ${MAX_PUBLIC_BUILDER_SEGMENTS}`,
    });
  } else if (segmentCount < 1 || segmentCount > input.market.maxSegments) {
    issues.push({
      path: "$.segmentLiquidities",
      code: "segment_count",
      message: `Candidate must contain between 1 and ${input.market.maxSegments} segments`,
    });
  }
  if (segmentCount > MAX_PUBLIC_BUILDER_SEGMENTS) {
    issues.push({
      path: "$.segmentLiquidities",
      code: "protocol_segment_limit",
      message: `Candidate cannot exceed ${MAX_PUBLIC_BUILDER_SEGMENTS} public-builder segments`,
    });
  }
  if (input.priceBreakpoints.length !== segmentCount + 1) {
    issues.push({
      path: "$.priceBreakpoints",
      code: "boundary_count",
      message: "A curve with N segments requires exactly N+1 price boundaries",
    });
  }
  if (
    typeof input.migrationQuoteThresholdAtomic !== "bigint" ||
    input.migrationQuoteThresholdAtomic <= 0n ||
    input.migrationQuoteThresholdAtomic > MAX_CURVE_U64
  ) {
    issues.push({
      path: "$.migrationQuoteThresholdAtomic",
      code: "out_of_range",
      message: "Migration quote threshold must be a positive u64 atomic amount",
    });
  }
  if (
    typeof input.market.totalBaseAtomic !== "bigint" ||
    input.market.totalBaseAtomic <= 0n ||
    input.market.totalBaseAtomic > MAX_CURVE_U64
  ) {
    issues.push({
      path: "$.market.totalBaseAtomic",
      code: "supply_out_of_range",
      message: "Total base supply must be a positive u64 atomic amount",
    });
  }

  for (const [index, liquidity] of input.segmentLiquidities.entries()) {
    if (typeof liquidity !== "bigint" || liquidity <= 0n || liquidity > MAX_CURVE_U128) {
      issues.push({
        path: `$.segmentLiquidities[${index}]`,
        code: "invalid_liquidity",
        message: "Segment liquidity must be a positive u128 bigint",
      });
    }
  }

  const prices = input.priceBreakpoints.map((price, index) => {
    if (!Decimal.isDecimal(price) || !price.isFinite() || !price.gt(0)) {
      issues.push({
        path: `$.priceBreakpoints[${index}]`,
        code: "invalid_price",
        message: "Price boundaries must be finite positive decimals",
      });
      return undefined;
    }
    if (index > 0) {
      const previous = input.priceBreakpoints[index - 1];
      if (previous && !price.gt(previous)) {
        issues.push({
          path: `$.priceBreakpoints[${index}]`,
          code: "non_increasing_price",
          message: "Price boundaries must increase strictly",
        });
      }
    }
    return price;
  });

  if (prices[0]?.eq(input.market.startPrice) !== true) {
    issues.push({
      path: "$.priceBreakpoints[0]",
      code: "start_price_mismatch",
      message: "The first candidate boundary must equal the normalized start price",
    });
  }
  if (prices[prices.length - 1]?.eq(input.market.migrationPrice) !== true) {
    issues.push({
      path: `$.priceBreakpoints[${prices.length - 1}]`,
      code: "migration_price_mismatch",
      message: "The final candidate boundary must equal the normalized migration price",
    });
  }
  if (issues.length > 0) return { status: "invalid", issues };

  const sqrtPrices: bigint[] = [];
  for (const [index, price] of prices.entries()) {
    if (!price) continue;
    try {
      const encoded = priceToSqrtPriceQ64x64(
        price.toFixed(),
        input.market.baseDecimals,
        input.market.quoteDecimals,
      );
      if (index > 0 && encoded <= (sqrtPrices[index - 1] ?? 0n)) {
        issues.push({
          path: `$.priceBreakpoints[${index}]`,
          code: "quantized_price_not_increasing",
          message: "Adjacent price boundaries collapse or descend after Q64.64 quantization",
        });
      }
      sqrtPrices.push(encoded);
    } catch (error) {
      issues.push({
        path: `$.priceBreakpoints[${index}]`,
        code: "price_out_of_protocol_range",
        message: error instanceof Error ? error.message : "Price cannot be encoded as Q64.64",
      });
    }
  }
  if (issues.length > 0) return { status: "invalid", issues };

  const segments: CurveSegment[] = input.segmentLiquidities.map((liquidity, index) => ({
    lowerSqrtPriceQ64x64: sqrtPrices[index] ?? 0n,
    upperSqrtPriceQ64x64: sqrtPrices[index + 1] ?? 0n,
    liquidity,
  }));
  const draft: DbcCurve = {
    baseDecimals: input.market.baseDecimals,
    quoteDecimals: input.market.quoteDecimals,
    startSqrtPriceQ64x64: sqrtPrices[0] ?? 0n,
    migrationQuoteThresholdAtomic: input.migrationQuoteThresholdAtomic,
    segments,
  };
  const shapeResult = validateDbcCurveShape(draft);
  if (shapeResult.status === "invalid") {
    issues.push(...shapeResult.issues.map(mapShapeIssue));
    return { status: "invalid", issues };
  }

  const quoteCapacityAtomic = quoteRequiredForSegments(shapeResult.curve.segments);
  if (shapeResult.curve.migrationQuoteThresholdAtomic > quoteCapacityAtomic) {
    issues.push({
      path: "$.migrationQuoteThresholdAtomic",
      code: "threshold_exceeds_curve_capacity",
      message: "Migration quote threshold cannot exceed the quote traversable through the curve",
    });
  }
  const baseDistributedAtomic = baseDistributedForSegments(shapeResult.curve.segments);
  if (baseDistributedAtomic > input.market.totalBaseAtomic) {
    issues.push({
      path: "$.segmentLiquidities",
      code: "supply_exceeded",
      message: "The curve distributes more base tokens than the total supply",
    });
  }
  if (issues.length > 0) return { status: "invalid", issues };

  return {
    status: "valid",
    curve: shapeResult.curve,
    quoteCapacityAtomic,
    baseDistributedAtomic,
  };
}

function invalid(path: string, code: string, message: string): CandidateCurveValidationResult {
  return { status: "invalid", issues: [{ path, code, message }] };
}

function mapShapeIssue(issue: CurveShapeIssue): CandidateCurveIssue {
  return { ...issue, path: `$.curve${issue.path.slice(1)}` };
}
