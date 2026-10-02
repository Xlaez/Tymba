import { Decimal } from "decimal.js";
import { MAX_CURVE_U64, MAX_PUBLIC_BUILDER_SEGMENTS } from "./curve.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100000, toExpPos: 100000 });
const BASIS_POINTS = 10_000n;

export const SOLVER_OBJECTIVE_TERMS = [
  "quoteError",
  "distributionError",
  "migrationPriceError",
  "earlyPriceImpact",
  "attackProfitability",
  "complexity",
] as const;

export type SolverObjectiveTerm = (typeof SOLVER_OBJECTIVE_TERMS)[number];

export type SolverObjectiveWeights = Readonly<Record<SolverObjectiveTerm, Decimal>>;

export type SolverObjectiveMeasurements = Readonly<{
  quoteTargetAtomic?: bigint;
  quoteAchievedAtomic?: bigint;
  distributionTargetBps?: bigint;
  distributionAchievedBps?: bigint;
  migrationPriceTarget?: Decimal;
  migrationPriceAchieved?: Decimal;
  earlyPriceImpactBps?: bigint;
  maxEarlyPriceImpactBps?: bigint;
  earlyPriceImpactProbeQuoteAtomic?: bigint;
  earlyPriceImpactEvidenceId?: string;
  attackerProfitQuoteAtomic?: bigint;
  attackerCapitalQuoteAtomic?: bigint;
  attackEvidenceId?: string;
  segmentCount?: number;
  maxSegments?: number;
}>;

export type SolverObjectiveTermResult = Readonly<{
  weight: Decimal;
  normalizedPenalty?: Decimal;
  weightedPenalty: Decimal;
}>;

export type SolverObjectiveEvaluation = Readonly<{
  score: Decimal;
  terms: Readonly<Record<SolverObjectiveTerm, SolverObjectiveTermResult>>;
  measurements: SolverObjectiveMeasurements;
}>;

export function evaluateSolverObjective(
  weightsInput: SolverObjectiveWeights,
  measurementsInput: SolverObjectiveMeasurements,
): SolverObjectiveEvaluation {
  const weights = normalizeWeights(weightsInput);
  const measurements = readMeasurements(measurementsInput);
  let score = new ExactDecimal(0);
  const terms = {} as Record<SolverObjectiveTerm, SolverObjectiveTermResult>;

  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const weight = weights[term];
    const normalizedPenalty = getPenalty(term, measurements, weight.gt(0));
    const weightedPenalty = normalizedPenalty ? weight.mul(normalizedPenalty) : new ExactDecimal(0);
    score = score.plus(weightedPenalty);
    terms[term] = {
      weight,
      ...(normalizedPenalty ? { normalizedPenalty } : {}),
      weightedPenalty,
    };
  }

  return { score, terms, measurements };
}

type NormalizedMeasurements = Readonly<{
  quoteTargetAtomic?: bigint;
  quoteAchievedAtomic?: bigint;
  distributionTargetBps?: bigint;
  distributionAchievedBps?: bigint;
  migrationPriceTarget?: Decimal;
  migrationPriceAchieved?: Decimal;
  earlyPriceImpactBps?: bigint;
  maxEarlyPriceImpactBps?: bigint;
  earlyPriceImpactProbeQuoteAtomic?: bigint;
  earlyPriceImpactEvidenceId?: string;
  attackerProfitQuoteAtomic?: bigint;
  attackerCapitalQuoteAtomic?: bigint;
  attackEvidenceId?: string;
  segmentCount?: number;
  maxSegments?: number;
}>;

function normalizeWeights(input: SolverObjectiveWeights): Record<SolverObjectiveTerm, Decimal> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Objective weights must be an object");
  }
  assertExactKeys(input, SOLVER_OBJECTIVE_TERMS, "Objective weights");
  const weights = {} as Record<SolverObjectiveTerm, Decimal>;
  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const weight = decimalValue(input[term], `${term} weight`);
    if (weight.lt(0)) throw new RangeError(`${term} weight must not be negative`);
    weights[term] = weight;
  }
  const sum = SOLVER_OBJECTIVE_TERMS.reduce(
    (total, term) => total.plus(weights[term]),
    new ExactDecimal(0),
  );
  if (!sum.eq(1)) throw new RangeError("Objective weights must sum exactly to one");
  return weights;
}

function readMeasurements(input: SolverObjectiveMeasurements): NormalizedMeasurements {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Objective measurements must be an object");
  }
  const keys = [
    "quoteTargetAtomic",
    "quoteAchievedAtomic",
    "distributionTargetBps",
    "distributionAchievedBps",
    "migrationPriceTarget",
    "migrationPriceAchieved",
    "earlyPriceImpactBps",
    "maxEarlyPriceImpactBps",
    "earlyPriceImpactProbeQuoteAtomic",
    "earlyPriceImpactEvidenceId",
    "attackerProfitQuoteAtomic",
    "attackerCapitalQuoteAtomic",
    "attackEvidenceId",
    "segmentCount",
    "maxSegments",
  ] as const;
  assertExactKeys(input, keys, "Objective measurements");

  const result: NormalizedMeasurements = {
    ...(input.quoteTargetAtomic === undefined
      ? {}
      : { quoteTargetAtomic: input.quoteTargetAtomic }),
    ...(input.quoteAchievedAtomic === undefined
      ? {}
      : { quoteAchievedAtomic: input.quoteAchievedAtomic }),
    ...(input.distributionTargetBps === undefined
      ? {}
      : { distributionTargetBps: input.distributionTargetBps }),
    ...(input.distributionAchievedBps === undefined
      ? {}
      : { distributionAchievedBps: input.distributionAchievedBps }),
    ...(input.migrationPriceTarget === undefined
      ? {}
      : {
          migrationPriceTarget: decimalValue(input.migrationPriceTarget, "Migration price target"),
        }),
    ...(input.migrationPriceAchieved === undefined
      ? {}
      : {
          migrationPriceAchieved: decimalValue(
            input.migrationPriceAchieved,
            "Achieved migration price",
          ),
        }),
    ...(input.earlyPriceImpactBps === undefined
      ? {}
      : { earlyPriceImpactBps: input.earlyPriceImpactBps }),
    ...(input.maxEarlyPriceImpactBps === undefined
      ? {}
      : { maxEarlyPriceImpactBps: input.maxEarlyPriceImpactBps }),
    ...(input.earlyPriceImpactProbeQuoteAtomic === undefined
      ? {}
      : { earlyPriceImpactProbeQuoteAtomic: input.earlyPriceImpactProbeQuoteAtomic }),
    ...(input.earlyPriceImpactEvidenceId === undefined
      ? {}
      : { earlyPriceImpactEvidenceId: input.earlyPriceImpactEvidenceId }),
    ...(input.attackerProfitQuoteAtomic === undefined
      ? {}
      : { attackerProfitQuoteAtomic: input.attackerProfitQuoteAtomic }),
    ...(input.attackerCapitalQuoteAtomic === undefined
      ? {}
      : { attackerCapitalQuoteAtomic: input.attackerCapitalQuoteAtomic }),
    ...(input.attackEvidenceId === undefined ? {} : { attackEvidenceId: input.attackEvidenceId }),
    ...(input.segmentCount === undefined ? {} : { segmentCount: input.segmentCount }),
    ...(input.maxSegments === undefined ? {} : { maxSegments: input.maxSegments }),
  };

  validateAtomicMeasurement(result.quoteTargetAtomic, "Quote target", true);
  validateAtomicMeasurement(result.quoteAchievedAtomic, "Achieved quote", false);
  validateBpsMeasurement(result.distributionTargetBps, "Distribution target");
  validateBpsMeasurement(result.distributionAchievedBps, "Achieved distribution");
  validateNonnegativeBpsMeasurement(result.earlyPriceImpactBps, "Early price impact");
  validateBpsMeasurement(result.maxEarlyPriceImpactBps, "Maximum early price impact");
  validateAtomicMeasurement(
    result.earlyPriceImpactProbeQuoteAtomic,
    "Early price-impact probe",
    true,
  );
  validateAtomicMeasurement(result.attackerCapitalQuoteAtomic, "Attacker quote capital", true);
  validateSignedAtomicMeasurement(result.attackerProfitQuoteAtomic, "Attacker quote profit");
  validateEvidenceId(result.earlyPriceImpactEvidenceId, "Early price-impact evidence id");
  validateEvidenceId(result.attackEvidenceId, "Attack evidence id");
  validatePositiveDecimal(result.migrationPriceTarget, "Migration price target");
  validatePositiveDecimal(result.migrationPriceAchieved, "Achieved migration price");
  validateSegmentMeasurement(result.segmentCount, "Segment count");
  validateSegmentMeasurement(result.maxSegments, "Maximum segment count");
  if (result.maxSegments !== undefined && result.maxSegments > MAX_PUBLIC_BUILDER_SEGMENTS) {
    throw new RangeError(`Maximum segment count must not exceed ${MAX_PUBLIC_BUILDER_SEGMENTS}`);
  }
  if (
    result.segmentCount !== undefined &&
    result.maxSegments !== undefined &&
    result.segmentCount > result.maxSegments
  ) {
    throw new RangeError("Segment count must not exceed maximum segment count");
  }

  return result;
}

function getPenalty(
  term: SolverObjectiveTerm,
  measurements: NormalizedMeasurements,
  required: boolean,
): Decimal | undefined {
  switch (term) {
    case "quoteError": {
      const { quoteTargetAtomic, quoteAchievedAtomic } = measurements;
      if (quoteTargetAtomic === undefined || quoteAchievedAtomic === undefined) {
        return missingMeasurement(term, required);
      }
      return ratio(abs(quoteAchievedAtomic - quoteTargetAtomic), quoteTargetAtomic);
    }
    case "distributionError": {
      const { distributionTargetBps, distributionAchievedBps } = measurements;
      if (distributionTargetBps === undefined || distributionAchievedBps === undefined) {
        return missingMeasurement(term, required);
      }
      return ratio(abs(distributionAchievedBps - distributionTargetBps), BASIS_POINTS);
    }
    case "migrationPriceError": {
      const { migrationPriceTarget, migrationPriceAchieved } = measurements;
      if (migrationPriceTarget === undefined || migrationPriceAchieved === undefined) {
        return missingMeasurement(term, required);
      }
      return migrationPriceAchieved.minus(migrationPriceTarget).abs().div(migrationPriceTarget);
    }
    case "earlyPriceImpact": {
      const { earlyPriceImpactBps, earlyPriceImpactProbeQuoteAtomic, earlyPriceImpactEvidenceId } =
        measurements;
      if (
        earlyPriceImpactBps === undefined ||
        earlyPriceImpactProbeQuoteAtomic === undefined ||
        earlyPriceImpactEvidenceId === undefined
      ) {
        return missingMeasurement(term, required);
      }
      const target = measurements.maxEarlyPriceImpactBps ?? 0n;
      const excess = earlyPriceImpactBps > target ? earlyPriceImpactBps - target : 0n;
      return ratio(excess, BASIS_POINTS);
    }
    case "attackProfitability": {
      const { attackerProfitQuoteAtomic, attackerCapitalQuoteAtomic, attackEvidenceId } =
        measurements;
      if (
        attackerProfitQuoteAtomic === undefined ||
        attackerCapitalQuoteAtomic === undefined ||
        attackEvidenceId === undefined
      ) {
        return missingMeasurement(term, required);
      }
      const positiveProfit = attackerProfitQuoteAtomic > 0n ? attackerProfitQuoteAtomic : 0n;
      return ratio(positiveProfit, attackerCapitalQuoteAtomic);
    }
    case "complexity": {
      const { segmentCount, maxSegments } = measurements;
      if (segmentCount === undefined || maxSegments === undefined) {
        return missingMeasurement(term, required);
      }
      return new ExactDecimal(segmentCount).div(maxSegments);
    }
  }
}

function missingMeasurement(term: SolverObjectiveTerm, required: boolean): undefined {
  if (required) throw new TypeError(`Measurements for positively weighted ${term} are required`);
  return undefined;
}

function validateAtomicMeasurement(
  value: bigint | undefined,
  label: string,
  positive: boolean,
): void {
  if (value === undefined) return;
  if (typeof value !== "bigint" || (positive ? value <= 0n : value < 0n) || value > MAX_CURVE_U64) {
    throw new RangeError(
      `${label} must be ${positive ? "a positive" : "a non-negative"} u64 amount`,
    );
  }
}

function validateSignedAtomicMeasurement(value: bigint | undefined, label: string): void {
  if (value !== undefined && typeof value !== "bigint") {
    throw new TypeError(`${label} must be a signed bigint amount`);
  }
}

function validateEvidenceId(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new TypeError(`${label} must be a non-empty safe string of at most 128 characters`);
  }
}

function validateBpsMeasurement(value: bigint | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "bigint" || value < 0n || value > BASIS_POINTS) {
    throw new RangeError(`${label} must be between 0 and 10,000 basis points`);
  }
}

function validateNonnegativeBpsMeasurement(value: bigint | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "bigint" || value < 0n || value > MAX_CURVE_U64) {
    throw new RangeError(`${label} must be a non-negative u64 basis-point amount`);
  }
}

function validatePositiveDecimal(value: Decimal | undefined, label: string): void {
  if (value !== undefined && !value.gt(0)) throw new RangeError(`${label} must be positive`);
}

function validateSegmentMeasurement(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PUBLIC_BUILDER_SEGMENTS) {
    throw new RangeError(`${label} must be an integer from 1 to ${MAX_PUBLIC_BUILDER_SEGMENTS}`);
  }
}

function decimalValue(value: Decimal, label: string): Decimal {
  if (!Decimal.isDecimal(value)) throw new TypeError(`${label} must be a Decimal`);
  const decimal = new ExactDecimal(value.toFixed());
  if (!decimal.isFinite()) throw new RangeError(`${label} must be finite`);
  return decimal;
}

function ratio(numerator: bigint, denominator: bigint): Decimal {
  return new ExactDecimal(numerator.toString()).div(denominator.toString());
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function assertExactKeys(input: object, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contain unsupported field ${key}`);
  }
}
