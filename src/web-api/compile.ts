import { type CompileDraftCandidate, compileDocument } from "../cli/compile.js";
import { currencyAmount, formatCurrencyAmount } from "../domain/currency-amount.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import { sqrtPriceQ64x64ToPrice } from "../domain/price.js";
import { quoteRequiredForSegment } from "../domain/segment-math.js";
import { DBC_SIMULATION_ENGINE_VERSION } from "../domain/simulator.js";
import { createConstraintConflictWarning } from "../domain/solver-result.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";
import { presentAdvanced } from "./advanced.js";
import type {
  WebCompileResponse,
  WebConflict,
  WebCurveSegment,
  WebDraftCandidate,
} from "./contracts.js";
import { isRecord } from "./review.js";

export function compileWebDocument(input: unknown): WebCompileResponse {
  const report = compileDocument(input);
  const market = validateMarketIntent(isRecord(input) ? input.marketIntent : undefined);
  const candidates = [...report.draftCandidates]
    .sort(
      (left, right) =>
        left.objectiveScore.comparedTo(right.objectiveScore) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, 3)
    .map((candidate, index) => ({
      ...presentCandidate(candidate, index + 1),
      ...(market.status === "valid" && isRecord(input)
        ? {
            advanced: presentAdvanced(candidate.id, candidate.curve, market.normalized, {
              objectiveWeights: input.objectiveWeights,
              simulation: input.simulation,
              ...(input.earlyPriceImpactProbeQuoteAtomic === undefined
                ? {}
                : { earlyPriceImpactProbeQuoteAtomic: input.earlyPriceImpactProbeQuoteAtomic }),
            }),
          }
        : {}),
    }));
  if (market.status === "valid") {
    for (const candidate of candidates) {
      const normalized = market.normalized;
      if (
        normalized.quoteToMigrationAtomic !== undefined &&
        candidate.quoteToMigration !==
          formatCurrencyAmount(
            currencyAmount(normalized.quoteToMigrationAtomic, normalized.quoteDecimals),
          )
      ) {
        candidate.conflicts.push(
          createConstraintConflictWarning({
            constraint: "quote_to_migration",
            path: "$.targets.quoteToMigration",
            target: formatCurrencyAmount(
              currencyAmount(normalized.quoteToMigrationAtomic, normalized.quoteDecimals),
            ),
            achieved: candidate.quoteToMigration,
            unit: normalized.assets.quote.symbol,
            candidateId: candidate.id,
          }),
        );
      }
      if (
        normalized.targetBaseDistributionBps !== undefined &&
        candidate.baseDistributionPct !== percent(normalized.targetBaseDistributionBps)
      ) {
        candidate.conflicts.push(
          createConstraintConflictWarning({
            constraint: "base_distribution",
            path: "$.targets.baseDistributionPct",
            target: percent(normalized.targetBaseDistributionBps),
            achieved: candidate.baseDistributionPct,
            unit: "% of supply",
            candidateId: candidate.id,
          }),
        );
      }
    }
  }
  return {
    status: report.status,
    ...(report.solverStatus ? { solverStatus: report.solverStatus } : {}),
    candidates,
    candidateCount: report.draftCandidates.length,
    deployableCandidateCount: 0,
    failure: report.failure,
    issues: report.issues,
    engineVersion: report.run?.engineVersion ?? DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: report.run?.sdkVersion ?? PINNED_METEORA_DBC_SDK_VERSION,
    algorithmVersion: report.run?.algorithmVersion ?? "initial-linear-grid-atomic-allocation-v1",
    warnings: [
      "Economic status assesses the core curve targets (capital and distribution). Endpoint prices are quantized. It does not prove full-config or supply validity.",
      "Launch profile and sniper-resistance preferences are retained but are not optimized or enforced by this initial curve search. No attacker behavior is tested here.",
      ...(market.status === "valid" &&
      (market.normalized.maxEarlyPriceImpactBps !== undefined ||
        market.normalized.earlyBuyerAdvantageBps !== undefined)
        ? [
            "Early price-impact and early-buyer-advantage goals are not assessed in this web compile path; do not treat them as satisfied.",
          ]
        : []),
      ...(market.status === "valid" && market.normalized.migration
        ? [
            "Post-graduation allocation intent is not mapped automatically to protocol allocation buckets.",
          ]
        : []),
    ],
  };
}

function presentCandidate(candidate: CompileDraftCandidate, rank: number): WebDraftCandidate {
  return {
    id: candidate.id,
    rank,
    segmentCount: candidate.curve.segments.length,
    objectiveScore: candidate.objectiveScore.toFixed(),
    quoteToMigration: formatCurrencyAmount(candidate.metrics.quoteToMigration),
    baseDistributed: formatCurrencyAmount(candidate.metrics.baseDistributed),
    baseDistributionPct: percent(candidate.metrics.baseDistributedBps),
    migrationPrice: candidate.metrics.migrationPrice.toFixed(),
    migrationFdv: candidate.metrics.migrationFdv.toFixed(),
    verificationStatus: "unverified",
    sdkCurveValidated: true,
    simulationId: candidate.simulation.id,
    conflicts: [] as WebConflict[],
    segments: presentSegments(candidate),
  };
}

function presentSegments(candidate: CompileDraftCandidate): readonly WebCurveSegment[] {
  let cumulativeQuote = 0n;
  return candidate.curve.segments.map((segment, index) => {
    const explanation = candidate.explanations.find(
      (entry) => entry.segmentIndex === index && entry.evidence?.kind === "segment_liquidity",
    );
    const evidence = explanation?.evidence;
    if (!explanation || !evidence) throw new Error("Candidate segment explanation is missing");
    const points = Array.from({ length: 25 }, (_, sample) => {
      const sqrtPrice =
        segment.lowerSqrtPriceQ64x64 +
        ((segment.upperSqrtPriceQ64x64 - segment.lowerSqrtPriceQ64x64) * BigInt(sample)) / 24n;
      const quote =
        sqrtPrice === segment.lowerSqrtPriceQ64x64
          ? 0n
          : quoteRequiredForSegment({ ...segment, upperSqrtPriceQ64x64: sqrtPrice });
      return {
        quote: formatCurrencyAmount(
          currencyAmount(cumulativeQuote + quote, candidate.curve.quoteDecimals),
        ),
        price: sqrtPriceQ64x64ToPrice(
          sqrtPrice,
          candidate.curve.baseDecimals,
          candidate.curve.quoteDecimals,
        ).toFixed(),
      };
    });
    cumulativeQuote += evidence.quoteAbsorbed.raw;
    return {
      index,
      lowerPrice: evidence.lowerPrice.toFixed(),
      upperPrice: evidence.upperPrice.toFixed(),
      quoteAbsorbed: formatCurrencyAmount(evidence.quoteAbsorbed),
      baseDistributed: formatCurrencyAmount(evidence.baseDistributed),
      quoteContributionPct: percent(evidence.quoteContributionBps),
      distributionContributionPct: percent(evidence.distributionContributionBps),
      explanation: explanation.message,
      points,
    };
  });
}

export function percent(bps: bigint): string {
  return formatCurrencyAmount(currencyAmount(bps, 2));
}
