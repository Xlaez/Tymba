import type { CurrencyAmount } from "./currency-amount.js";
import type { DbcCurve } from "./curve.js";
import type { FeeConfiguration } from "./fees.js";
import type { MigrationConfiguration } from "./migration.js";
import type { SolverStatus, VerificationStatus } from "./status.js";
import { Decimal } from "decimal.js";
import type { SolverObjectiveTerm } from "./solver-objective.js";

export type { SolverStatus, VerificationStatus } from "./status.js";

export type SolverMetricSet = Readonly<{
  quoteToMigration: CurrencyAmount;
  baseDistributed: CurrencyAmount;
  baseDistributedBps: bigint;
  migrationPrice: Decimal;
  migrationFdv: Decimal;
}>;

export type SolverExplanation = Readonly<{
  code: string;
  message: string;
  segmentIndex?: number;
  evidence?: SolverExplanationEvidence;
}>;

export type SolverExplanationEvidence = Readonly<{
  kind: "segment_liquidity";
  lowerPrice: Decimal;
  upperPrice: Decimal;
  liquidity: bigint;
  quoteAbsorbed: CurrencyAmount;
  baseDistributed: CurrencyAmount;
  quoteContributionBps: bigint;
  distributionContributionBps: bigint;
  weightedObjectiveTerms: readonly Readonly<{
    term: Extract<SolverObjectiveTerm, "quoteError" | "distributionError">;
    weight: Decimal;
  }>[];
}>;

export type SolverWarningCode =
  | "constraint_conflict"
  | "target_not_met"
  | "protocol_limit"
  | "unsupported_configuration"
  | "allocation_mapping_unresolved"
  | "verification_pending";

export type SolverConstraintCode =
  | "quote_to_migration"
  | "base_distribution"
  | "migration_price"
  | "early_price_impact"
  | "early_buyer_advantage";

export type SolverAlternative = Readonly<{
  path: string;
  suggestedValue: string;
  unit: string;
  explanation: string;
}>;

export type SolverWarning = Readonly<{
  code: SolverWarningCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  path?: string;
  candidateId?: string;
  verificationStatus?: VerificationStatus;
  alternatives?: readonly SolverAlternative[];
}>;

export type ConstraintConflictInput = Readonly<{
  constraint: SolverConstraintCode;
  path: string;
  target: string;
  achieved: string;
  unit: string;
  candidateId?: string;
}>;

export type SolvedMarketCandidate = Readonly<{
  id: string;
  curve: DbcCurve;
  metrics: SolverMetricSet;
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  objectiveScore: Decimal;
  verificationStatus: VerificationStatus;
  explanations: readonly SolverExplanation[];
}>;

export type SolverResult = Readonly<{
  status: SolverStatus;
  candidates: readonly SolvedMarketCandidate[];
  warnings: readonly SolverWarning[];
}>;

export type CandidateConstraintAssessment = Readonly<{
  candidateId: string;
  unmetConstraintCodes: readonly string[];
}>;

export function deriveSolverStatus(
  feasibleCandidates: readonly CandidateConstraintAssessment[],
): SolverStatus {
  if (feasibleCandidates.length === 0) return "unsatisfied";
  if (feasibleCandidates.some((candidate) => candidate.unmetConstraintCodes.length === 0)) {
    return "satisfied";
  }
  return "partial";
}

const ExactDecimal = Decimal.clone({ precision: 1024, toExpNeg: -100000, toExpPos: 100000 });
const CONSTRAINT_LABELS: Readonly<Record<SolverConstraintCode, string>> = {
  quote_to_migration: "Capital before graduation",
  base_distribution: "Base supply distributed before graduation",
  migration_price: "Graduation price",
  early_price_impact: "Early price impact",
  early_buyer_advantage: "Early-buyer price advantage",
};

export function createConstraintConflictWarning(input: ConstraintConflictInput): SolverWarning {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Constraint conflict input must be an object");
  }
  if (!Object.hasOwn(CONSTRAINT_LABELS, input.constraint)) {
    throw new TypeError("Constraint code is not supported");
  }
  const label = CONSTRAINT_LABELS[input.constraint];
  const target = parseEconomicValue(input.target, "target");
  const achieved = parseEconomicValue(input.achieved, "achieved value");
  if (typeof input.unit !== "string") throw new TypeError("Constraint unit must be a string");
  const unit = input.unit.trim();
  if (!unit || unit.length > 64 || hasControlCharacters(unit)) {
    throw new TypeError("Constraint unit must be non-empty and contain no control characters");
  }
  if (
    typeof input.path !== "string" ||
    input.path.length > 256 ||
    !/^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[\d+\])+$/.test(input.path)
  ) {
    throw new TypeError("Constraint path must be an absolute field path");
  }
  if (
    input.candidateId !== undefined &&
    (typeof input.candidateId !== "string" ||
      input.candidateId.length === 0 ||
      input.candidateId.length > 128 ||
      hasControlCharacters(input.candidateId))
  ) {
    throw new TypeError("Candidate id must be a string when provided");
  }
  if (target.eq(achieved)) throw new RangeError("A satisfied target is not a constraint conflict");

  const targetText = target.toFixed();
  const achievedText = achieved.toFixed();
  const differenceValue = achieved.minus(target).toFixed();
  const difference = differenceValue.startsWith("-") ? differenceValue : `+${differenceValue}`;
  const direction = achieved.lt(target) ? "below" : "above";
  const lowerLabel = label.charAt(0).toLowerCase() + label.slice(1);

  return {
    code: "target_not_met",
    severity: "warning",
    message: `${label}: requested ${targetText} ${unit}, while this candidate measures ${achievedText} ${unit} (${difference} ${unit} versus target, ${direction} target). To consider this candidate, revise the requested value to ${achievedText} ${unit}.`,
    path: input.path,
    ...(input.candidateId === undefined ? {} : { candidateId: input.candidateId }),
    alternatives: [
      {
        path: input.path,
        suggestedValue: achievedText,
        unit,
        explanation: `This is the candidate's measured ${lowerLabel}; revising the goal to this value does not guarantee another compilation will reproduce the candidate.`,
      },
    ],
  };
}

function parseEconomicValue(value: string, field: string): Decimal {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  ) {
    throw new TypeError(`Constraint ${field} must be a non-negative plain decimal string`);
  }
  return new ExactDecimal(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
