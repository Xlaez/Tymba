import { Decimal } from "decimal.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type { DeterministicSimulationResult } from "./simulation.js";
import type { SdkCurveValidationEvidence } from "./solver-sdk-validation.js";
import type { SolverObjectiveEvaluation } from "./solver-objective.js";
import type { SolverMetricSet, SolverWarning } from "./solver-result.js";
import type { SolverStatus } from "./status.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "./solver-sdk-validation.js";

export interface SolverRunJsonObject {
  readonly [key: string]: SolverRunJsonValue;
}

export type SolverRunJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SolverRunJsonValue[]
  | SolverRunJsonObject;

export type SolverRunCandidate = Readonly<{
  id: string;
  metrics: SolverMetricSet;
  objective: SolverObjectiveEvaluation;
  objectiveScore: Decimal;
  simulation: DeterministicSimulationResult;
  sdkCurveValidation: SdkCurveValidationEvidence;
  verificationStatus: "unverified";
}>;

export type SolverRunIssue = Readonly<{
  code: string;
  message: string;
  candidateId?: string;
}>;

export type SolverRunRecord = Readonly<{
  engineVersion: "0.1.0";
  algorithmVersion: "initial-linear-grid-atomic-allocation-v1";
  sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
  deterministic: true;
  randomSeed: null;
  seedPolicy: "not-applicable-no-randomness";
  status: SolverStatus;
  input: SolverRunJsonValue;
  configuration: Readonly<{
    maxSegments: number;
    initialSegmentCount: number | null;
    priceBoundaryStrategy: "linear-human-price-v1";
    liquidityAllocationStrategy: "deterministic-atomic-target-splits-v1";
    simulation: SolverRunJsonValue | null;
    earlyPriceImpactProbeQuoteAtomic: string | null;
    earlyPriceImpactEvaluatorProvided: boolean;
    attackExposureEvaluatorProvided: boolean;
  }>;
  objectiveWeights: SolverRunJsonValue | null;
  outputMetrics: readonly SolverRunJsonValue[];
  issues: readonly SolverRunIssue[];
  warnings: readonly Readonly<{ code: string; severity: string; message: string }>[];
}>;

export function createSolverRunRecord(
  input: Readonly<{
    market: NormalizedMarketIntent;
    options: unknown;
    status: SolverStatus;
    candidates: readonly SolverRunCandidate[];
    issues: readonly SolverRunIssue[];
    warnings: readonly SolverWarning[];
  }>,
): SolverRunRecord {
  const options = isRecord(input.options) ? input.options : {};
  const maxSegments = input.market.maxSegments;
  let initialSegmentCount: number | null = null;
  if (Number.isInteger(maxSegments) && maxSegments >= 1 && maxSegments <= 16) {
    initialSegmentCount = Math.min(3, maxSegments);
  }

  return {
    engineVersion: "0.1.0",
    algorithmVersion: "initial-linear-grid-atomic-allocation-v1",
    sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
    deterministic: true,
    randomSeed: null,
    seedPolicy: "not-applicable-no-randomness",
    status: input.status,
    input: toJsonValue(input.market),
    configuration: {
      maxSegments,
      initialSegmentCount,
      priceBoundaryStrategy: "linear-human-price-v1",
      liquidityAllocationStrategy: "deterministic-atomic-target-splits-v1",
      simulation: toJsonValue(options.simulation ?? null),
      earlyPriceImpactProbeQuoteAtomic:
        typeof options.earlyPriceImpactProbeQuoteAtomic === "bigint"
          ? options.earlyPriceImpactProbeQuoteAtomic.toString()
          : null,
      earlyPriceImpactEvaluatorProvided: typeof options.earlyPriceImpactEvaluator === "function",
      attackExposureEvaluatorProvided: typeof options.attackExposureEvaluator === "function",
    },
    objectiveWeights:
      options.objectiveWeights === undefined ? null : toJsonValue(options.objectiveWeights),
    outputMetrics: input.candidates.map(candidateOutput),
    issues: input.issues.map(({ code, message, candidateId }) => ({
      code,
      message,
      ...(candidateId === undefined ? {} : { candidateId }),
    })),
    warnings: input.warnings.map(({ code, severity, message }) => ({ code, severity, message })),
  };
}

function candidateOutput(candidate: SolverRunCandidate): SolverRunJsonValue {
  return {
    candidateId: candidate.id,
    metrics: {
      quoteToMigrationAtomic: candidate.metrics.quoteToMigration.raw.toString(),
      baseDistributedAtomic: candidate.metrics.baseDistributed.raw.toString(),
      baseDistributedBps: candidate.metrics.baseDistributedBps.toString(),
      migrationPrice: candidate.metrics.migrationPrice.toFixed(),
      migrationFdv: candidate.metrics.migrationFdv.toFixed(),
    },
    objective: {
      score: candidate.objectiveScore.toFixed(),
      terms: toJsonValue(candidate.objective.terms),
      measurements: toJsonValue(candidate.objective.measurements),
    },
    simulation: {
      id: candidate.simulation.id,
      status: candidate.simulation.status,
      engineVersion: candidate.simulation.engineVersion,
      sdkVersion: candidate.simulation.sdkVersion,
    },
    sdkCurveValidation: {
      sdkVersion: candidate.sdkCurveValidation.sdkVersion,
      curveEntryCount: candidate.sdkCurveValidation.curveEntryCount,
      startSqrtPriceQ64x64: candidate.sdkCurveValidation.startSqrtPriceQ64x64.toString(),
      terminalSqrtPriceQ64x64: candidate.sdkCurveValidation.terminalSqrtPriceQ64x64.toString(),
    },
    verificationStatus: candidate.verificationStatus,
  };
}

function toJsonValue(value: unknown): SolverRunJsonValue {
  if (value === null) return null;
  if (Decimal.isDecimal(value)) return value.toFixed();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined || typeof entry === "function" ? null : toJsonValue(entry),
    );
  }
  if (isRecord(value)) {
    const record: Record<string, SolverRunJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined || typeof entry === "function") continue;
      record[key] = toJsonValue(entry);
    }
    return record;
  }
  if (typeof value === "undefined" || typeof value === "function") return null;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
