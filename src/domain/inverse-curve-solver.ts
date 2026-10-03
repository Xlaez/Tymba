import { Decimal } from "decimal.js";
import { currencyAmount, formatCurrencyAmount } from "./currency-amount.js";
import type { DbcCurve, CurveSegment } from "./curve.js";
import { MAX_CURVE_U64 } from "./curve.js";
import { quoteRequiredForSegments } from "./segment-math.js";
import { generateInitialPriceBreakpoints } from "./solver-candidate-generation.js";
import {
  solveSegmentLiquidityForBaseTarget,
  solveSegmentLiquidityForQuoteTarget,
} from "./solver-liquidity.js";
import { validateCandidateCurve } from "./solver-candidate-validation.js";
import type { SdkCurveValidationEvidence } from "./solver-sdk-validation.js";
import { validateSolverCandidateCurveWithSdk } from "./solver-sdk-validation.js";
import type { SolverRunRecord } from "./solver-run-record.js";
import { createSolverRunRecord } from "./solver-run-record.js";
import { evaluateSolverObjective } from "./solver-objective.js";
import { SOLVER_OBJECTIVE_TERMS } from "./solver-objective.js";
import type {
  SolverObjectiveEvaluation,
  SolverObjectiveMeasurements,
  SolverObjectiveWeights,
} from "./solver-objective.js";
import { explainCandidateLiquidity } from "./solver-explanations.js";
import type { SolverSimulationConfiguration } from "./solver-deterministic-verification.js";
import {
  validateSolverSimulationConfiguration,
  verifyCandidateWithDeterministicSimulator,
} from "./solver-deterministic-verification.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type { SolverExplanation, SolverMetricSet, SolverWarning } from "./solver-result.js";
import type { SolverStatus } from "./status.js";
import { priceToSqrtPriceQ64x64 } from "./price.js";
import type { DeterministicSimulationResult } from "./simulation.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100000, toExpPos: 100000 });
const BASIS_POINTS = 10_000n;

export type CandidateAttackExposure = Readonly<{
  attackerProfitQuoteAtomic: bigint;
  attackerCapitalQuoteAtomic: bigint;
  evidenceId: string;
}>;

export type CandidatePriceImpactMeasurement = Readonly<{
  priceImpactBps: bigint;
  evidenceId: string;
}>;

export type CandidatePriceImpactEvaluator = (
  input: Readonly<{
    candidateId: string;
    curve: DbcCurve;
    probeQuoteAtomic: bigint;
  }>,
) => CandidatePriceImpactMeasurement;

export type CandidateAttackExposureEvaluator = (
  input: Readonly<{
    candidateId: string;
    curve: DbcCurve;
  }>,
) => CandidateAttackExposure;

export type InverseCurveSolverOptions = Readonly<{
  objectiveWeights: SolverObjectiveWeights;
  simulation: SolverSimulationConfiguration;
  earlyPriceImpactProbeQuoteAtomic?: bigint;
  earlyPriceImpactEvaluator?: CandidatePriceImpactEvaluator;
  attackExposureEvaluator?: CandidateAttackExposureEvaluator;
}>;

export type InverseCurveCandidate = Readonly<{
  id: string;
  curve: DbcCurve;
  metrics: SolverMetricSet;
  simulation: DeterministicSimulationResult;
  sdkCurveValidation: SdkCurveValidationEvidence;
  objective: SolverObjectiveEvaluation;
  objectiveScore: Decimal;
  verificationStatus: "unverified";
  meetsRequestedTargets: boolean;
  explanations: readonly SolverExplanation[];
}>;

export type InverseCurveSolverIssue = Readonly<{
  code: string;
  message: string;
  candidateId?: string;
}>;

export type InverseCurveSolverResult = Readonly<{
  status: SolverStatus;
  candidates: readonly InverseCurveCandidate[];
  issues: readonly InverseCurveSolverIssue[];
  warnings: readonly SolverWarning[];
  run: SolverRunRecord;
}>;

type CandidateTargetAllocation = Readonly<{
  kind: "quote" | "base" | "neutral";
  targetsAtomic: readonly bigint[];
}>;

type CandidateEvaluationResult =
  | Readonly<{ status: "valid"; candidate: InverseCurveCandidate }>
  | Readonly<{ status: "invalid"; issue: InverseCurveSolverIssue }>;

export function solveMarketCurve(
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
): InverseCurveSolverResult {
  const optionIssues = validateObjectiveOptions(market, options);
  if (optionIssues.length > 0) {
    return createSolverResult(market, options, "unsatisfied", [], optionIssues, []);
  }
  const simulationConfiguration = validateSolverSimulationConfiguration(options.simulation);
  if (simulationConfiguration.status === "invalid") {
    return createSolverResult(
      market,
      options,
      "unsatisfied",
      [],
      simulationConfiguration.issues,
      [],
    );
  }

  let priceBreakpoints: readonly Decimal[];
  let sqrtPriceBreakpoints: readonly bigint[];
  try {
    priceBreakpoints = generateInitialPriceBreakpoints(market);
    sqrtPriceBreakpoints = priceBreakpoints.map((price) =>
      priceToSqrtPriceQ64x64(price.toFixed(), market.baseDecimals, market.quoteDecimals),
    );
  } catch (error) {
    return createSolverResult(
      market,
      options,
      "unsatisfied",
      [],
      [issue("invalid_price_grid", errorMessage(error))],
      [],
    );
  }

  const intervals = toIntervals(sqrtPriceBreakpoints);
  const allocations = getTargetAllocations(market, intervals);
  if (allocations.length === 0) {
    const minimumQuoteAtomic = BigInt(intervals.length);
    const requestedQuote = market.quoteToMigrationAtomic;
    const quoteSymbol = market.assets.quote.symbol;
    const message =
      requestedQuote !== undefined && requestedQuote < minimumQuoteAtomic
        ? `Requested pre-migration quote target ${formatCurrencyAmount(currencyAmount(requestedQuote, market.quoteDecimals))} ${quoteSymbol} (${requestedQuote} atomic unit${requestedQuote === 1n ? "" : "s"}) cannot fund the initial ${intervals.length}-segment curve. Positive liquidity in every segment requires at least ${formatCurrencyAmount(currencyAmount(minimumQuoteAtomic, market.quoteDecimals))} ${quoteSymbol} (${minimumQuoteAtomic} atomic units). Increase $.targets.quoteToMigration to at least that amount or reduce $.solver.maxSegments to ${requestedQuote} or fewer.`
        : "The requested quote and distribution targets cannot be allocated across the generated price intervals";
    return createSolverResult(
      market,
      options,
      "unsatisfied",
      [],
      [issue("quote_target_below_segment_minimum", message)],
      [],
    );
  }

  const candidates: InverseCurveCandidate[] = [];
  const issues: InverseCurveSolverIssue[] = [];
  const seenIds = new Set<string>();
  for (const allocation of allocations) {
    let result: CandidateEvaluationResult;
    try {
      result = evaluateAllocation(
        market,
        options,
        simulationConfiguration.value,
        allocation,
        priceBreakpoints,
        intervals,
      );
    } catch (error) {
      issues.push(issue("candidate_evaluation_failed", errorMessage(error)));
      continue;
    }
    if (result.status === "invalid") {
      issues.push(result.issue);
      continue;
    }
    if (!seenIds.has(result.candidate.id)) {
      seenIds.add(result.candidate.id);
      candidates.push(result.candidate);
    }
  }

  const status = candidates.some((candidate) => candidate.meetsRequestedTargets)
    ? "satisfied"
    : candidates.length > 0
      ? "partial"
      : "unsatisfied";

  const warnings: readonly SolverWarning[] =
    candidates.length === 0
      ? []
      : [
          {
            code: "verification_pending",
            severity: "warning",
            message:
              "Curve candidates have passed local validation, deterministic simulation, and pinned-SDK curve validation; complete DBC configuration/supply validation is still required before ranking or treating them as deployable.",
            verificationStatus: "unverified",
          },
        ];
  return createSolverResult(market, options, status, candidates, issues, warnings);
}

function createSolverResult(
  market: NormalizedMarketIntent,
  options: unknown,
  status: SolverStatus,
  candidates: readonly InverseCurveCandidate[],
  issues: readonly InverseCurveSolverIssue[],
  warnings: readonly SolverWarning[],
): InverseCurveSolverResult {
  const run = createSolverRunRecord({ market, options, status, candidates, issues, warnings });
  return { status, candidates, issues, warnings, run };
}

function validateObjectiveOptions(
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
): readonly InverseCurveSolverIssue[] {
  if (typeof options !== "object" || options === null) {
    return [issue("invalid_objective_options", "Objective options are required")];
  }
  const weights = options.objectiveWeights;
  if (!weights || typeof weights !== "object") {
    return [issue("missing_objective_weights", "Explicit objective weights are required")];
  }
  const issues: InverseCurveSolverIssue[] = [];
  for (const key of Object.keys(weights)) {
    if (!SOLVER_OBJECTIVE_TERMS.includes(key as (typeof SOLVER_OBJECTIVE_TERMS)[number])) {
      issues.push(issue("unknown_objective_weight", `Unsupported objective weight: ${key}`));
    }
  }
  let weightSum = new ExactDecimal(0);
  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const weight = weights[term];
    if (!Decimal.isDecimal(weight) || !weight.isFinite() || weight.lt(0)) {
      issues.push(
        issue("invalid_objective_weight", `${term} weight must be a finite non-negative Decimal`),
      );
      continue;
    }
    weightSum = weightSum.plus(weight.toFixed());
  }
  if (!weightSum.eq(1)) {
    issues.push(
      issue("objective_weights_not_normalized", "Objective weights must sum exactly to one"),
    );
  }
  if (issues.length > 0) return issues;
  if (weights.quoteError.gt(0) && market.quoteToMigrationAtomic === undefined) {
    issues.push(
      issue(
        "missing_quote_target",
        "A positively weighted quote objective requires a quote target",
      ),
    );
  }
  if (weights.distributionError.gt(0) && market.targetBaseDistributionBps === undefined) {
    issues.push(
      issue(
        "missing_distribution_target",
        "A positively weighted distribution objective requires a base-distribution target",
      ),
    );
  }
  if (
    weights.earlyPriceImpact.gt(0) &&
    (typeof options.earlyPriceImpactProbeQuoteAtomic !== "bigint" ||
      options.earlyPriceImpactProbeQuoteAtomic <= 0n)
  ) {
    issues.push(
      issue(
        "missing_price_impact_probe",
        "A positively weighted early-price-impact objective requires an explicit positive quote probe",
      ),
    );
  }
  if (weights.earlyPriceImpact.gt(0) && typeof options.earlyPriceImpactEvaluator !== "function") {
    issues.push(
      issue(
        "missing_price_impact_measurement",
        "A positively weighted early-price-impact objective requires a deterministic measurement provider",
      ),
    );
  }
  if (weights.attackProfitability.gt(0) && typeof options.attackExposureEvaluator !== "function") {
    issues.push(
      issue(
        "missing_attack_measurement",
        "A positively weighted attack objective requires a deterministic attack-measurement provider",
      ),
    );
  }
  return issues;
}

function getTargetAllocations(
  market: NormalizedMarketIntent,
  intervals: readonly Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">[],
): readonly CandidateTargetAllocation[] {
  const segmentCount = intervals.length;
  if (market.quoteToMigrationAtomic !== undefined) {
    if (market.quoteToMigrationAtomic < BigInt(segmentCount)) return [];
    if (market.targetBaseDistributionBps === undefined) {
      return [
        {
          kind: "quote",
          targetsAtomic: allocateAtomicByWeights(
            market.quoteToMigrationAtomic,
            Array.from({ length: segmentCount }, () => 1n),
            true,
          ),
        },
      ];
    }
    const targetBaseAtomic =
      (market.totalBaseAtomic * market.targetBaseDistributionBps) / BASIS_POINTS;
    return generateQuoteAllocationsForTargets(
      intervals,
      market.quoteToMigrationAtomic,
      targetBaseAtomic,
    );
  }

  if (market.targetBaseDistributionBps !== undefined) {
    const targetBaseAtomic =
      (market.totalBaseAtomic * market.targetBaseDistributionBps) / BASIS_POINTS;
    return [
      {
        kind: "base",
        targetsAtomic: allocateAtomicByWeights(
          targetBaseAtomic,
          Array.from({ length: segmentCount }, () => 1n),
          false,
        ),
      },
    ];
  }

  return [{ kind: "neutral", targetsAtomic: Array.from({ length: segmentCount }, () => 1n) }];
}

function generateQuoteAllocationsForTargets(
  intervals: readonly Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">[],
  targetQuoteAtomic: bigint,
  targetBaseAtomic: bigint,
): readonly CandidateTargetAllocation[] {
  const count = intervals.length;
  if (count === 1) return [{ kind: "quote", targetsAtomic: [targetQuoteAtomic] }];
  const allocations = new Map<string, readonly bigint[]>();
  if (count === 2) {
    addPairAllocations(
      allocations,
      intervals,
      targetQuoteAtomic,
      targetBaseAtomic,
      0,
      1,
      undefined,
    );
  } else {
    for (let unpaired = 0; unpaired < count; unpaired += 1) {
      const pair = Array.from({ length: count }, (_, index) => index).filter(
        (index) => index !== unpaired,
      );
      const first = pair[0];
      const second = pair[1];
      if (first !== undefined && second !== undefined) {
        addPairAllocations(
          allocations,
          intervals,
          targetQuoteAtomic,
          targetBaseAtomic,
          first,
          second,
          unpaired,
        );
      }
    }
  }
  return [...allocations.values()].map((targetsAtomic) => ({ kind: "quote", targetsAtomic }));
}

function addPairAllocations(
  allocations: Map<string, readonly bigint[]>,
  intervals: readonly Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">[],
  targetQuoteAtomic: bigint,
  targetBaseAtomic: bigint,
  first: number,
  second: number,
  unpaired: number | undefined,
): void {
  const minimumOtherQuote = unpaired === undefined ? 0n : 1n;
  const remainingQuote = targetQuoteAtomic - minimumOtherQuote;
  const firstInterval = intervals[first];
  const secondInterval = intervals[second];
  if (!firstInterval || !secondInterval || remainingQuote < 2n) return;
  const firstRatio = basePerQuoteRatio(firstInterval);
  const secondRatio = basePerQuoteRatio(secondInterval);
  if (firstRatio.eq(secondRatio)) return;

  let remainingBase = new ExactDecimal(targetBaseAtomic.toString());
  if (unpaired !== undefined) {
    const interval = intervals[unpaired];
    if (!interval) return;
    const minimum = solveSegmentLiquidityForQuoteTarget(interval, 1n);
    remainingBase = remainingBase.minus(minimum.achievedAtomic.toString());
  }

  const estimate = remainingBase
    .minus(secondRatio.mul(remainingQuote.toString()))
    .div(firstRatio.minus(secondRatio));
  const floorEstimate = BigInt(estimate.floor().toFixed(0));
  const candidates = new Set<bigint>([1n, remainingQuote - 1n]);
  for (const offset of [-2n, -1n, 0n, 1n, 2n]) {
    const value = floorEstimate + offset;
    if (value >= 1n && value < remainingQuote) candidates.add(value);
  }

  for (const firstQuote of candidates) {
    const targets = Array.from({ length: intervals.length }, () => 1n);
    targets[first] = firstQuote;
    targets[second] = remainingQuote - firstQuote;
    if (unpaired !== undefined) targets[unpaired] = 1n;
    const key = targets.join(":");
    allocations.set(key, targets);
  }
}

function basePerQuoteRatio(
  interval: Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">,
): Decimal {
  return new ExactDecimal((1n << 128n).toString()).div(
    (interval.lowerSqrtPriceQ64x64 * interval.upperSqrtPriceQ64x64).toString(),
  );
}

function allocateAtomicByWeights(
  total: bigint,
  weights: readonly bigint[],
  requirePositive: boolean,
): readonly bigint[] {
  const minimum = requirePositive ? BigInt(weights.length) : 0n;
  if (total < minimum) return [];
  const remaining = total - minimum;
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  let allocated = 0n;
  return weights.map((weight, index) => {
    const share =
      index === weights.length - 1 ? remaining - allocated : (remaining * weight) / weightTotal;
    allocated += share;
    return share + (requirePositive ? 1n : 0n);
  });
}

function toIntervals(
  breakpoints: readonly bigint[],
): readonly Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">[] {
  return breakpoints.slice(1).map((upper, index) => {
    const lower = breakpoints[index];
    if (lower === undefined) throw new Error("Price breakpoint sequence is inconsistent");
    return { lowerSqrtPriceQ64x64: lower, upperSqrtPriceQ64x64: upper };
  });
}

function evaluateAllocation(
  market: NormalizedMarketIntent,
  options: InverseCurveSolverOptions,
  simulationConfiguration: SolverSimulationConfiguration,
  allocation: CandidateTargetAllocation,
  priceBreakpoints: readonly Decimal[],
  intervals: readonly Pick<CurveSegment, "lowerSqrtPriceQ64x64" | "upperSqrtPriceQ64x64">[],
): CandidateEvaluationResult {
  const liquiditySolutions = allocation.targetsAtomic.map((target, index) => {
    const interval = intervals[index];
    if (!interval) throw new Error("Target allocation does not match curve segment count");
    if (allocation.kind === "quote") return solveSegmentLiquidityForQuoteTarget(interval, target);
    if (allocation.kind === "base") return solveSegmentLiquidityForBaseTarget(interval, target);
    return { liquidity: 1n };
  });
  const segmentLiquidities = liquiditySolutions.map((solution) => solution.liquidity);
  const quoteCapacityAtomic = segmentLiquidities.reduce((total, liquidity, index) => {
    const interval = intervals[index];
    if (!interval) throw new Error("Liquidity allocation does not match curve segment count");
    return total + quoteRequiredForSegments([{ ...interval, liquidity }]);
  }, 0n);
  if (quoteCapacityAtomic <= 0n || quoteCapacityAtomic > MAX_CURVE_U64) {
    return {
      status: "invalid",
      issue: issue(
        "quote_capacity_out_of_range",
        "Candidate quote capacity is outside positive u64 range",
      ),
    };
  }

  const validation = validateCandidateCurve({
    market,
    priceBreakpoints,
    segmentLiquidities,
    migrationQuoteThresholdAtomic: quoteCapacityAtomic,
  });
  if (validation.status === "invalid") {
    return {
      status: "invalid",
      issue: issue(
        "candidate_curve_invalid",
        validation.issues.map(({ message }) => message).join("; "),
      ),
    };
  }

  const candidateId = `curve-${allocation.kind}-${allocation.targetsAtomic.join("-")}`;
  const simulatorVerification = verifyCandidateWithDeterministicSimulator({
    candidateId,
    market,
    curve: validation.curve,
    configuration: simulationConfiguration,
  });
  if (simulatorVerification.status === "invalid") {
    return {
      status: "invalid",
      issue: issue(
        "deterministic_simulation_failed",
        simulatorVerification.issues.map(({ message }) => message).join("; "),
        candidateId,
      ),
    };
  }
  const simulation = simulatorVerification.simulation;
  const sdkValidation = validateSolverCandidateCurveWithSdk(validation.curve);
  if (sdkValidation.status === "invalid") {
    return {
      status: "invalid",
      issue: issue(
        "meteora_sdk_curve_rejected",
        sdkValidation.issues.map(({ message }) => message).join("; "),
        candidateId,
      ),
    };
  }
  let earlyImpact: CandidatePriceImpactMeasurement | undefined;
  if (options.objectiveWeights.earlyPriceImpact.gt(0)) {
    const probe = options.earlyPriceImpactProbeQuoteAtomic;
    if (probe === undefined) throw new Error("Positive price-impact weight requires a quote probe");
    const evaluator = options.earlyPriceImpactEvaluator;
    if (!evaluator) throw new Error("Positive price-impact weight requires a measurement provider");
    earlyImpact = evaluator({ candidateId, curve: validation.curve, probeQuoteAtomic: probe });
  }

  const attack = options.objectiveWeights.attackProfitability.gt(0)
    ? options.attackExposureEvaluator?.({ candidateId, curve: validation.curve })
    : undefined;
  const quoteToMigrationAtomic = simulation.metrics.quoteAccumulated.amount.raw;
  const baseDistributedAtomic = simulation.metrics.baseDistributed.amount.raw;
  const migrationPrice = simulation.metrics.finalMigrationPrice;
  if (!migrationPrice) {
    return {
      status: "invalid",
      issue: issue(
        "deterministic_simulation_missing_metrics",
        "Deterministic simulator did not return a final migration price",
        candidateId,
      ),
    };
  }
  const baseDistributedBps = simulation.metrics.baseDistributedBps;
  const metrics: SolverMetricSet = {
    quoteToMigration: currencyAmount(quoteToMigrationAtomic, market.quoteDecimals),
    baseDistributed: currencyAmount(baseDistributedAtomic, market.baseDecimals),
    baseDistributedBps,
    migrationPrice,
    migrationFdv:
      simulation.metrics.finalMigrationFdv ??
      migrationPrice
        .mul(market.totalBaseAtomic.toString())
        .div((10n ** BigInt(market.baseDecimals)).toString()),
  };
  const measurements: SolverObjectiveMeasurements = {
    ...(market.quoteToMigrationAtomic === undefined
      ? {}
      : {
          quoteTargetAtomic: market.quoteToMigrationAtomic,
          quoteAchievedAtomic: quoteToMigrationAtomic,
        }),
    ...(market.targetBaseDistributionBps === undefined
      ? {}
      : {
          distributionTargetBps: market.targetBaseDistributionBps,
          distributionAchievedBps: baseDistributedBps,
        }),
    migrationPriceTarget: market.migrationPrice,
    migrationPriceAchieved: migrationPrice,
    ...(market.maxEarlyPriceImpactBps === undefined
      ? {}
      : { maxEarlyPriceImpactBps: market.maxEarlyPriceImpactBps }),
    ...(earlyImpact === undefined ||
    options.earlyPriceImpactProbeQuoteAtomic === undefined ||
    earlyImpact.evidenceId === undefined
      ? {}
      : {
          earlyPriceImpactBps: earlyImpact.priceImpactBps,
          earlyPriceImpactProbeQuoteAtomic: options.earlyPriceImpactProbeQuoteAtomic,
          earlyPriceImpactEvidenceId: earlyImpact.evidenceId,
        }),
    ...(attack === undefined
      ? {}
      : {
          attackerProfitQuoteAtomic: attack.attackerProfitQuoteAtomic,
          attackerCapitalQuoteAtomic: attack.attackerCapitalQuoteAtomic,
          attackEvidenceId: attack.evidenceId,
        }),
    segmentCount: validation.curve.segments.length,
    maxSegments: market.maxSegments,
  };
  let objective: SolverObjectiveEvaluation;
  try {
    objective = evaluateSolverObjective(options.objectiveWeights, measurements);
  } catch (error) {
    return {
      status: "invalid",
      issue: issue("objective_measurement_invalid", errorMessage(error), candidateId),
    };
  }

  const meetsQuote =
    market.quoteToMigrationAtomic === undefined ||
    market.quoteToMigrationAtomic === quoteToMigrationAtomic;
  const meetsDistribution =
    market.targetBaseDistributionBps === undefined ||
    market.targetBaseDistributionBps === baseDistributedBps;
  const explanationCurve = { ...validation.curve };
  const explanations = explainCandidateLiquidity({ market, curve: explanationCurve, objective });

  return {
    status: "valid",
    candidate: {
      id: candidateId,
      curve: validation.curve,
      metrics,
      simulation,
      sdkCurveValidation: sdkValidation.evidence,
      objective,
      objectiveScore: objective.score,
      verificationStatus: "unverified",
      meetsRequestedTargets: meetsQuote && meetsDistribution,
      explanations,
    },
  };
}

function issue(code: string, message: string, candidateId?: string): InverseCurveSolverIssue {
  return { code, message, ...(candidateId === undefined ? {} : { candidateId }) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Inverse curve candidate evaluation failed";
}
