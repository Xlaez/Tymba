import type { AuditFinding } from "./audit.js";
import {
  convertAuditFindingsToSolverObjective,
  type AuditSolverObjectiveConversion,
} from "./audit-solver-objective.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type {
  InverseCurveCandidate,
  InverseCurveSolverOptions,
  InverseCurveSolverResult,
} from "./inverse-curve-solver.js";
import { solveMarketCurve } from "./inverse-curve-solver.js";
import { priceToSqrtPriceQ64x64 } from "./price.js";

export type HardenedCandidateGenerationIssue = Readonly<{
  code: string;
  message: string;
  candidateId?: string;
}>;

export type RejectedHardenedCandidate = Readonly<{
  candidateId: string;
  conflicts: readonly string[];
}>;

export type HardenedCandidateGenerationResult = Readonly<{
  status: "generated" | "partial" | "unsatisfied";
  originalMarket: NormalizedMarketIntent;
  originalCandidate: InverseCurveCandidate;
  selectedFindings: readonly AuditFinding[];
  conversion: AuditSolverObjectiveConversion;
  solverResult?: InverseCurveSolverResult;
  hardenedCandidate?: InverseCurveCandidate;
  baselineMeetsRequestedTargets: boolean;
  rejectedCandidates: readonly RejectedHardenedCandidate[];
  issues: readonly HardenedCandidateGenerationIssue[];
}>;

export type GenerateHardenedCandidateInput = Readonly<{
  originalMarket: NormalizedMarketIntent;
  originalCandidate: InverseCurveCandidate;
  originalSolverOptions: InverseCurveSolverOptions;
  selectedFindings: readonly AuditFinding[];
  addedRiskWeights: Parameters<typeof convertAuditFindingsToSolverObjective>[0]["addedRiskWeights"];
}>;

export function generateHardenedCandidate(
  input: GenerateHardenedCandidateInput,
): HardenedCandidateGenerationResult {
  validateInput(input);
  const baselineStructuralIssues = validateCandidateIdentity(
    input.originalCandidate,
    input.originalMarket,
    input.originalSolverOptions,
  );
  const conversion = convertAuditFindingsToSolverObjective({
    originalWeights: input.originalSolverOptions.objectiveWeights,
    findings: input.selectedFindings,
    market: input.originalMarket,
    addedRiskWeights: input.addedRiskWeights,
    ...(input.originalSolverOptions.earlyPriceImpactProbeQuoteAtomic === undefined
      ? {}
      : {
          earlyPriceImpactProbeQuoteAtomic:
            input.originalSolverOptions.earlyPriceImpactProbeQuoteAtomic,
        }),
  });
  const baselineEarlyImpactBps = conversion.mappings.find(
    ({ objectiveTerm }) => objectiveTerm === "earlyPriceImpact",
  )?.rawMetricValueBps;
  const baselineMeetsRequestedTargets =
    baselineStructuralIssues.length === 0 &&
    input.originalCandidate.meetsRequestedTargets &&
    candidateMeetsRequestedTargets(
      input.originalCandidate,
      input.originalMarket,
      input.originalSolverOptions,
      baselineEarlyImpactBps,
    );
  const issues: HardenedCandidateGenerationIssue[] = baselineStructuralIssues.map((message) => ({
    code: "baseline_candidate_mismatch",
    message,
    candidateId: input.originalCandidate.id,
  }));
  if (conversion.status === "unsupported" || !conversion.objectiveWeights) {
    issues.push({
      code: "no_supported_audit_objective",
      message: "No selected audit finding can currently be converted into a solver objective.",
    });
    return {
      status: "unsatisfied",
      originalMarket: input.originalMarket,
      originalCandidate: input.originalCandidate,
      selectedFindings: input.selectedFindings,
      conversion,
      baselineMeetsRequestedTargets,
      rejectedCandidates: [],
      issues,
    };
  }

  for (const evaluator of conversion.requiredEvaluators) {
    if (
      evaluator === "earlyPriceImpactEvaluator" &&
      typeof input.originalSolverOptions.earlyPriceImpactEvaluator !== "function"
    ) {
      issues.push({
        code: "missing_comparable_price_impact_evaluator",
        message:
          "The mapped early-impact penalty requires a candidate evaluator using the retained quote probe and a comparable scenario.",
      });
    }
    if (
      evaluator === "attackExposureEvaluator" &&
      typeof input.originalSolverOptions.attackExposureEvaluator !== "function"
    ) {
      issues.push({
        code: "missing_comparable_attack_evaluator",
        message:
          "The mapped sniper-return penalty requires a candidate evaluator using a comparable opening-attack scenario and capital basis.",
      });
    }
  }
  if (baselineStructuralIssues.length > 0 || issues.length > baselineStructuralIssues.length) {
    return {
      status: "unsatisfied",
      originalMarket: input.originalMarket,
      originalCandidate: input.originalCandidate,
      selectedFindings: input.selectedFindings,
      conversion,
      baselineMeetsRequestedTargets,
      rejectedCandidates: [],
      issues,
    };
  }

  const solverResult = solveMarketCurve(input.originalMarket, {
    ...input.originalSolverOptions,
    objectiveWeights: conversion.objectiveWeights,
  });
  issues.push(
    ...solverResult.issues.map(({ code, message, candidateId }) => ({
      code,
      message,
      ...(candidateId === undefined ? {} : { candidateId }),
    })),
  );
  const rejectedCandidates = solverResult.candidates.flatMap((candidate) => {
    const targetConflicts = candidateTargetConflicts(
      candidate,
      input.originalMarket,
      input.originalSolverOptions,
    );
    const conflicts = [
      ...validateCandidateIdentity(candidate, input.originalMarket, input.originalSolverOptions),
      ...targetConflicts,
      ...(!candidate.meetsRequestedTargets && targetConflicts.length === 0
        ? ["Solver candidate is not marked as meeting all original requested targets."]
        : []),
    ];
    if (
      candidateMeetsRequestedTargets(
        candidate,
        input.originalMarket,
        input.originalSolverOptions,
      ) &&
      conflicts.length === 0
    ) {
      return [];
    }
    return [{ candidateId: candidate.id, conflicts }];
  });
  const eligibleCandidates = solverResult.candidates.filter(
    (candidate) =>
      candidate.meetsRequestedTargets &&
      candidateMeetsRequestedTargets(
        candidate,
        input.originalMarket,
        input.originalSolverOptions,
      ) &&
      validateCandidateIdentity(candidate, input.originalMarket, input.originalSolverOptions)
        .length === 0 &&
      candidateTargetConflicts(candidate, input.originalMarket, input.originalSolverOptions)
        .length === 0,
  );
  const hardenedCandidate = [...eligibleCandidates].sort(compareCandidates)[0];
  if (!hardenedCandidate) {
    issues.push({
      code: "no_hardened_candidate_preserves_intent",
      message:
        "The hardened solver produced no candidate that preserves the original requested economic constraints.",
    });
    return {
      status: "unsatisfied",
      originalMarket: input.originalMarket,
      originalCandidate: input.originalCandidate,
      selectedFindings: input.selectedFindings,
      conversion,
      solverResult,
      baselineMeetsRequestedTargets,
      rejectedCandidates,
      issues,
    };
  }

  const partial = conversion.status === "partial" || !baselineMeetsRequestedTargets;
  return {
    status: partial ? "partial" : "generated",
    originalMarket: input.originalMarket,
    originalCandidate: input.originalCandidate,
    selectedFindings: input.selectedFindings,
    conversion,
    solverResult,
    hardenedCandidate,
    baselineMeetsRequestedTargets,
    rejectedCandidates,
    issues,
  };
}

function validateCandidateIdentity(
  candidate: InverseCurveCandidate,
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
): readonly string[] {
  const issues: string[] = [];
  const initialState = candidate.simulation.initialState;
  const curve = candidate.curve;
  const expectedStart = priceToSqrtPriceQ64x64(
    market.startPrice.toFixed(),
    market.baseDecimals,
    market.quoteDecimals,
  );
  const expectedMigration = priceToSqrtPriceQ64x64(
    market.migrationPrice.toFixed(),
    market.baseDecimals,
    market.quoteDecimals,
  );
  if (
    curve.baseDecimals !== market.baseDecimals ||
    curve.quoteDecimals !== market.quoteDecimals ||
    curve.startSqrtPriceQ64x64 !== expectedStart ||
    curve.segments.at(-1)?.upperSqrtPriceQ64x64 !== expectedMigration ||
    curve.segments.length > market.maxSegments
  ) {
    issues.push("Candidate curve boundaries or asset decimals do not match the original intent.");
  }
  if (!sameCurve(curve, initialState.curve)) {
    issues.push("Candidate simulation did not use the candidate's exact curve.");
  }
  if (
    initialState.supply.totalBaseSupply.amount.raw !== market.totalBaseAtomic ||
    initialState.supply.totalBaseSupply.amount.decimals !== market.baseDecimals
  ) {
    issues.push("Candidate simulation total base supply does not match the original intent.");
  }
  if (
    candidate.metrics.quoteToMigration.raw !==
      candidate.simulation.metrics.quoteAccumulated.amount.raw ||
    candidate.metrics.baseDistributed.raw !==
      candidate.simulation.metrics.baseDistributed.amount.raw ||
    !candidate.metrics.migrationPrice.eq(candidate.simulation.metrics.finalMigrationPrice ?? "NaN")
  ) {
    issues.push("Candidate metrics do not match the retained deterministic simulation.");
  }
  if (candidate.curve.migrationQuoteThresholdAtomic !== candidate.metrics.quoteToMigration.raw) {
    issues.push(
      "Candidate migration threshold does not match its measured quote-to-migration value.",
    );
  }
  if (!sameValue(initialState.fees, options.simulation.fees)) {
    issues.push(
      "Baseline candidate fee configuration differs from the original solver configuration.",
    );
  }
  if (!sameValue(initialState.migration, options.simulation.migration)) {
    issues.push(
      "Baseline candidate migration configuration differs from the original solver configuration.",
    );
  }
  if (
    initialState.supply.mode !== options.simulation.supplyMode ||
    !sameValue(initialState.clock, options.simulation.clock) ||
    initialState.activationPoint !== options.simulation.activationPoint ||
    initialState.activationType !== options.simulation.activationType ||
    !sameValue(initialState.dynamicFeeState, options.simulation.dynamicFeeState)
  ) {
    issues.push(
      "Baseline candidate simulator setup differs from the original solver configuration.",
    );
  }
  return issues;
}

function candidateMeetsRequestedTargets(
  candidate: InverseCurveCandidate,
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
  earlyImpactOverrideBps?: bigint,
): boolean {
  return candidateTargetConflicts(candidate, market, options, earlyImpactOverrideBps).length === 0;
}

function candidateTargetConflicts(
  candidate: InverseCurveCandidate,
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
  earlyImpactOverrideBps?: bigint,
): readonly string[] {
  const conflicts: string[] = [];
  if (
    market.quoteToMigrationAtomic !== undefined &&
    candidate.metrics.quoteToMigration.raw !== market.quoteToMigrationAtomic
  ) {
    conflicts.push("Candidate quote-to-migration amount differs from the original target.");
  }
  if (
    market.targetBaseDistributionBps !== undefined &&
    candidate.metrics.baseDistributedBps !== market.targetBaseDistributionBps
  ) {
    conflicts.push("Candidate base distribution differs from the original target.");
  }
  if (market.maxEarlyPriceImpactBps !== undefined) {
    const measuredImpactBps = earlyImpactOverrideBps ?? candidateEarlyImpactBps(candidate, options);
    if (measuredImpactBps === undefined) {
      conflicts.push(
        "Candidate has no comparable early-price-impact measurement for the original maximum-impact target.",
      );
    } else if (measuredImpactBps > market.maxEarlyPriceImpactBps) {
      conflicts.push(
        `Candidate early price impact ${measuredImpactBps} bps exceeds the original ${market.maxEarlyPriceImpactBps} bps limit.`,
      );
    }
  }
  return conflicts;
}

function candidateEarlyImpactBps(
  candidate: InverseCurveCandidate,
  options: InverseCurveSolverOptions,
): bigint | undefined {
  const measurements = candidate.objective.measurements;
  if (
    measurements.earlyPriceImpactBps !== undefined &&
    measurements.earlyPriceImpactProbeQuoteAtomic === options.earlyPriceImpactProbeQuoteAtomic &&
    typeof measurements.earlyPriceImpactEvidenceId === "string" &&
    measurements.earlyPriceImpactEvidenceId.trim().length > 0
  ) {
    return measurements.earlyPriceImpactBps;
  }
  const evaluator = options.earlyPriceImpactEvaluator;
  const probeQuoteAtomic = options.earlyPriceImpactProbeQuoteAtomic;
  if (typeof evaluator !== "function" || typeof probeQuoteAtomic !== "bigint") return undefined;
  try {
    const measurement = evaluator({
      candidateId: candidate.id,
      curve: candidate.curve,
      probeQuoteAtomic,
    });
    return typeof measurement?.priceImpactBps === "bigint" &&
      measurement.priceImpactBps >= 0n &&
      typeof measurement.evidenceId === "string" &&
      measurement.evidenceId.trim().length > 0
      ? measurement.priceImpactBps
      : undefined;
  } catch {
    return undefined;
  }
}

function sameCurve(
  left: InverseCurveCandidate["curve"],
  right: InverseCurveCandidate["curve"],
): boolean {
  return (
    left.baseDecimals === right.baseDecimals &&
    left.quoteDecimals === right.quoteDecimals &&
    left.startSqrtPriceQ64x64 === right.startSqrtPriceQ64x64 &&
    left.migrationQuoteThresholdAtomic === right.migrationQuoteThresholdAtomic &&
    left.segments.length === right.segments.length &&
    left.segments.every((segment, index) => {
      const other = right.segments[index];
      return (
        other !== undefined &&
        segment.lowerSqrtPriceQ64x64 === other.lowerSqrtPriceQ64x64 &&
        segment.upperSqrtPriceQ64x64 === other.upperSqrtPriceQ64x64 &&
        segment.liquidity === other.liquidity
      );
    })
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) => Object.hasOwn(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function compareCandidates(left: InverseCurveCandidate, right: InverseCurveCandidate): number {
  const scoreOrder = left.objectiveScore.comparedTo(right.objectiveScore);
  return scoreOrder !== 0 ? scoreOrder : left.id.localeCompare(right.id);
}

function validateInput(input: GenerateHardenedCandidateInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Hardened candidate input must be an object");
  }
  if (!Array.isArray(input.selectedFindings)) {
    throw new TypeError("Selected findings must be an array");
  }
  if (typeof input.originalMarket !== "object" || input.originalMarket === null) {
    throw new TypeError("Original normalized market intent is required");
  }
  if (typeof input.originalCandidate !== "object" || input.originalCandidate === null) {
    throw new TypeError("Original solver candidate is required");
  }
  if (typeof input.originalSolverOptions !== "object" || input.originalSolverOptions === null) {
    throw new TypeError("Original solver configuration is required");
  }
}
