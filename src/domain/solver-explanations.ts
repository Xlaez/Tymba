import { Decimal } from "decimal.js";
import { formatCurrencyAmount } from "./currency-amount.js";
import { validateDbcCurveShape, type DbcCurve } from "./curve.js";
import {
  baseDistributedForSegment,
  baseDistributedForSegments,
  quoteRequiredForSegment,
  quoteRequiredForSegments,
} from "./segment-math.js";
import { priceToSqrtPriceQ64x64, sqrtPriceQ64x64ToPrice } from "./price.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type { SolverObjectiveEvaluation } from "./solver-objective.js";
import type { SolverExplanation, SolverExplanationEvidence } from "./solver-result.js";

const BASIS_POINTS = 10_000n;

export type CandidateLiquidityExplanationInput = Readonly<{
  market: NormalizedMarketIntent;
  curve: DbcCurve;
  objective: SolverObjectiveEvaluation;
}>;

export function explainCandidateLiquidity(
  input: CandidateLiquidityExplanationInput,
): readonly SolverExplanation[] {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Candidate liquidity explanation input must be an object");
  }
  const curveResult = validateDbcCurveShape(input.curve);
  if (curveResult.status === "invalid") {
    throw new RangeError(
      `Cannot explain an invalid curve: ${curveResult.issues[0]?.message ?? "invalid curve"}`,
    );
  }
  const { curve } = curveResult;
  if (
    curve.baseDecimals !== input.market.baseDecimals ||
    curve.quoteDecimals !== input.market.quoteDecimals
  ) {
    throw new RangeError("Curve asset decimals must match the normalized market intent");
  }
  if (curve.segments.length > input.market.maxSegments) {
    throw new RangeError("Curve segment count must not exceed the normalized market maximum");
  }
  if (
    curve.startSqrtPriceQ64x64 !==
      priceToSqrtPriceQ64x64(
        input.market.startPrice.toFixed(),
        curve.baseDecimals,
        curve.quoteDecimals,
      ) ||
    curve.segments[curve.segments.length - 1]?.upperSqrtPriceQ64x64 !==
      priceToSqrtPriceQ64x64(
        input.market.migrationPrice.toFixed(),
        curve.baseDecimals,
        curve.quoteDecimals,
      )
  ) {
    throw new RangeError("Curve endpoints must match the normalized start and migration prices");
  }
  const curveQuoteCapacity = quoteRequiredForSegments(curve.segments);
  if (curve.migrationQuoteThresholdAtomic > curveQuoteCapacity) {
    throw new RangeError("Curve migration threshold must not exceed local quote capacity");
  }
  if (baseDistributedForSegments(curve.segments) > input.market.totalBaseAtomic) {
    throw new RangeError("Curve base distribution must not exceed normalized total supply");
  }

  const segmentMetrics = curve.segments.map((segment) => ({
    segment,
    quoteAbsorbedAtomic: quoteRequiredForSegment(segment),
    baseDistributedAtomic: baseDistributedForSegment(segment),
  }));
  const totalQuoteAtomic = segmentMetrics.reduce(
    (total, metric) => total + metric.quoteAbsorbedAtomic,
    0n,
  );
  const totalBaseAtomic = segmentMetrics.reduce(
    (total, metric) => total + metric.baseDistributedAtomic,
    0n,
  );
  const weightedObjectiveTerms = getWeightedAllocationTerms(input.objective);

  return segmentMetrics.map(({ segment, quoteAbsorbedAtomic, baseDistributedAtomic }, index) => {
    const lowerPrice = sqrtPriceQ64x64ToPrice(
      segment.lowerSqrtPriceQ64x64,
      curve.baseDecimals,
      curve.quoteDecimals,
    );
    const upperPrice = sqrtPriceQ64x64ToPrice(
      segment.upperSqrtPriceQ64x64,
      curve.baseDecimals,
      curve.quoteDecimals,
    );
    const quoteContributionBps = shareBps(quoteAbsorbedAtomic, totalQuoteAtomic);
    const distributionContributionBps = shareBps(baseDistributedAtomic, totalBaseAtomic);
    const evidence: SolverExplanationEvidence = {
      kind: "segment_liquidity",
      lowerPrice,
      upperPrice,
      liquidity: segment.liquidity,
      quoteAbsorbed: { raw: quoteAbsorbedAtomic, decimals: curve.quoteDecimals },
      baseDistributed: { raw: baseDistributedAtomic, decimals: curve.baseDecimals },
      quoteContributionBps,
      distributionContributionBps,
      weightedObjectiveTerms,
    };
    const objectiveDescription = describeObjectiveDrivers(weightedObjectiveTerms);
    const message =
      `Segment ${index + 1} spans ${formatPrice(lowerPrice)}–${formatPrice(upperPrice)} ` +
      `${input.market.assets.quote.symbol}/${input.market.assets.base.symbol}. Its selected liquidity ` +
      `${objectiveDescription}; the curve math assigns ${formatCurrencyAmount(evidence.quoteAbsorbed)} ` +
      `${input.market.assets.quote.symbol} of quote absorption and ` +
      `${formatCurrencyAmount(evidence.baseDistributed)} ${input.market.assets.base.symbol} of distribution ` +
      `to this band (${formatPercent(quoteContributionBps)} of curve quote and ` +
      `${formatPercent(distributionContributionBps)} of curve distribution). More liquidity in the same ` +
      `price band can require more quote to traverse it and can increase base distribution across that band.`;

    return {
      code: "segment_liquidity_rationale",
      message,
      segmentIndex: index,
      evidence,
    };
  });
}

function getWeightedAllocationTerms(
  objective: SolverObjectiveEvaluation,
): SolverExplanationEvidence["weightedObjectiveTerms"] {
  const terms: SolverExplanationEvidence["weightedObjectiveTerms"][number]["term"][] = [
    "quoteError",
    "distributionError",
  ];
  return terms.flatMap((term) => {
    const weight = objective.terms[term]?.weight;
    return weight?.gt(0) ? [{ term, weight }] : [];
  });
}

function describeObjectiveDrivers(
  terms: SolverExplanationEvidence["weightedObjectiveTerms"],
): string {
  const includesQuote = terms.some(({ term }) => term === "quoteError");
  const includesDistribution = terms.some(({ term }) => term === "distributionError");
  if (includesQuote && includesDistribution) {
    return "contributes to the weighted capital and distribution fit";
  }
  if (includesQuote) return "contributes to the weighted capital fit";
  if (includesDistribution) return "contributes to the weighted distribution fit";
  return "has no active capital or distribution fit weight, so these amounts are descriptive evidence";
}

function shareBps(amount: bigint, total: bigint): bigint {
  if (total === 0n) return 0n;
  return (amount * BASIS_POINTS) / total;
}

function formatPrice(price: Decimal): string {
  return price.toSignificantDigits(8, Decimal.ROUND_HALF_UP).toString();
}

function formatPercent(bps: bigint): string {
  return `${new Decimal(bps.toString()).div(100).toFixed(2)}%`;
}
