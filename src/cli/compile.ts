import { Decimal } from "decimal.js";
import type {
  InverseCurveCandidate,
  InverseCurveSolverIssue,
} from "../domain/inverse-curve-solver.js";
import { solveMarketCurve } from "../domain/inverse-curve-solver.js";
import type { DbcCurve } from "../domain/curve.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import { validateSolverSimulationConfiguration } from "../domain/solver-deterministic-verification.js";
import type { SolverObjectiveWeights } from "../domain/solver-objective.js";
import { SOLVER_OBJECTIVE_TERMS } from "../domain/solver-objective.js";
import type { SolverRunRecord } from "../domain/solver-run-record.js";
import type { DeterministicSimulationMetrics } from "../domain/simulation.js";
import type { SdkCurveValidationEvidence } from "../domain/solver-sdk-validation.js";
import type { SolverExplanation, SolverMetricSet } from "../domain/solver-result.js";
import type { SolverStatus } from "../domain/status.js";
import { convertConfigBigintStrings } from "./validate.js";

export type CompileIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type CompileDraftCandidate = Readonly<{
  id: string;
  curve: DbcCurve;
  metrics: SolverMetricSet;
  objective: InverseCurveCandidate["objective"];
  objectiveScore: Decimal;
  simulation: Readonly<{
    id: string;
    status: "completed" | "partial";
    metrics: DeterministicSimulationMetrics;
  }>;
  sdkCurveValidation: SdkCurveValidationEvidence;
  verificationStatus: "unverified";
  explanations: readonly SolverExplanation[];
}>;

export type CliCompileReport = Readonly<{
  command: "compile";
  status: "blocked" | "failed";
  solverStatus?: SolverStatus;
  deployableCandidates: readonly [];
  draftCandidates: readonly CompileDraftCandidate[];
  run?: SolverRunRecord;
  failure: Readonly<{ code: string; message: string }>;
  issues: readonly CompileIssue[];
}>;

const COMPILE_REQUEST_FIELDS = new Set([
  "marketIntent",
  "objectiveWeights",
  "simulation",
  "earlyPriceImpactProbeQuoteAtomic",
]);
const PLAIN_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;

export function compileDocument(input: unknown): CliCompileReport {
  if (!isRecord(input)) {
    return blockedReport(
      "invalid_compile_request",
      "Compile input must be a JSON object containing marketIntent, objectiveWeights, and simulation.",
    );
  }

  const issues: CompileIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!COMPILE_REQUEST_FIELDS.has(key)) {
      issues.push({
        path: `$.${key}`,
        code: "unknown_compile_request_field",
        message: "Field is not supported in a Tymba compile request",
      });
    }
  }
  if (
    input.marketIntent === undefined ||
    input.objectiveWeights === undefined ||
    input.simulation === undefined
  ) {
    return blockedReport(
      "explicit_solver_configuration_required",
      "A MarketIntent alone is not enough to compile. Provide explicit objectiveWeights and a simulation configuration (fees, migration, supply mode, clock, and activation settings); Tymba will not invent defaults.",
      issues,
    );
  }

  const marketResult = validateMarketIntent(input.marketIntent);
  if (marketResult.status === "invalid") {
    issues.push(...marketResult.issues.map(({ path, code, message }) => ({ path, code, message })));
  }
  const objectiveWeights = parseObjectiveWeights(input.objectiveWeights, issues);
  let simulation: unknown;
  try {
    simulation = convertConfigBigintStrings(input.simulation, "$.simulation");
  } catch (error) {
    issues.push({
      path: error instanceof ConfigIntegerError ? error.path : "$.simulation",
      code: "invalid_integer_string",
      message:
        error instanceof Error
          ? error.message
          : "Simulation integer fields must be decimal strings",
    });
  }
  let earlyPriceImpactProbeQuoteAtomic: bigint | undefined;
  if (input.earlyPriceImpactProbeQuoteAtomic !== undefined) {
    if (
      typeof input.earlyPriceImpactProbeQuoteAtomic !== "string" ||
      !UNSIGNED_INTEGER.test(input.earlyPriceImpactProbeQuoteAtomic) ||
      BigInt(input.earlyPriceImpactProbeQuoteAtomic) <= 0n
    ) {
      issues.push({
        path: "$.earlyPriceImpactProbeQuoteAtomic",
        code: "invalid_price_impact_probe",
        message: "Price-impact probe must be a positive quote-atomic decimal string",
      });
    } else {
      earlyPriceImpactProbeQuoteAtomic = BigInt(input.earlyPriceImpactProbeQuoteAtomic);
    }
  }
  if (issues.length > 0 || marketResult.status !== "valid" || !objectiveWeights) {
    return failedReport(
      "invalid_compile_request",
      "Compile request validation failed; no candidate was emitted.",
      issues,
    );
  }
  const simulationValidation = validateSolverSimulationConfiguration(simulation);
  if (simulationValidation.status === "invalid") {
    return failedReport(
      "invalid_simulation_configuration",
      "Deterministic simulation configuration is invalid; no candidate was emitted.",
      simulationValidation.issues.map(({ code, message }) => ({
        path: "$.simulation",
        code,
        message,
      })),
    );
  }

  const solverResult = solveMarketCurve(marketResult.normalized, {
    objectiveWeights,
    simulation: simulationValidation.value,
    ...(earlyPriceImpactProbeQuoteAtomic === undefined ? {} : { earlyPriceImpactProbeQuoteAtomic }),
  });
  if (solverResult.status === "unsatisfied" || solverResult.candidates.length === 0) {
    const solverIssues = solverResult.issues.map((issue) => toCompileIssue(issue));
    return {
      command: "compile",
      status: "failed",
      solverStatus: solverResult.status,
      deployableCandidates: [],
      draftCandidates: [],
      run: solverResult.run,
      failure: {
        code: "solver_unsatisfied",
        message:
          "No feasible curve candidate was found. See solver issues for the unmet constraints.",
      },
      issues: solverIssues,
    };
  }

  return {
    command: "compile",
    status: "blocked",
    solverStatus: solverResult.status,
    deployableCandidates: [],
    draftCandidates: solverResult.candidates.map(toCompileDraft),
    run: solverResult.run,
    failure: {
      code: "full_configuration_validation_pending",
      message:
        "Curve drafts passed deterministic simulation and pinned-SDK curve validation, but complete DBC configuration and token-supply validation are not implemented. No deployable candidate or protocol configuration was emitted.",
    },
    issues: [
      {
        path: "$.compile",
        code: "full_configuration_validation_pending",
        message:
          "Complete the pinned SDK config-parameter and supply validators before promoting any draft to a deployable candidate.",
      },
    ],
  };
}

function toCompileDraft(candidate: InverseCurveCandidate): CompileDraftCandidate {
  return {
    id: candidate.id,
    curve: candidate.curve,
    metrics: candidate.metrics,
    objective: candidate.objective,
    objectiveScore: candidate.objectiveScore,
    simulation: {
      id: candidate.simulation.id,
      status: candidate.simulation.status,
      metrics: candidate.simulation.metrics,
    },
    sdkCurveValidation: candidate.sdkCurveValidation,
    verificationStatus: candidate.verificationStatus,
    explanations: candidate.explanations,
  };
}

export function formatCompileReport(report: CliCompileReport): string {
  const lines = [
    `Compile: ${report.status.toUpperCase()}`,
    `Failure: ${report.failure.message}`,
    `Deployable candidates: ${report.deployableCandidates.length}`,
    `Curve drafts: ${report.draftCandidates.length}`,
  ];
  if (report.solverStatus) lines.push(`Solver status: ${report.solverStatus}`);
  if (report.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue.path} [${issue.code}]: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

function parseObjectiveWeights(
  input: unknown,
  issues: CompileIssue[],
): SolverObjectiveWeights | undefined {
  if (!isRecord(input)) {
    issues.push({
      path: "$.objectiveWeights",
      code: "invalid_objective_weights",
      message: "Objective weights must be an object of decimal strings",
    });
    return undefined;
  }
  for (const key of Object.keys(input)) {
    if (!SOLVER_OBJECTIVE_TERMS.includes(key as (typeof SOLVER_OBJECTIVE_TERMS)[number])) {
      issues.push({
        path: `$.objectiveWeights.${key}`,
        code: "unknown_objective_weight",
        message: "Objective weight is not supported",
      });
    }
  }
  const values = {} as Record<(typeof SOLVER_OBJECTIVE_TERMS)[number], Decimal>;
  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const value = input[term];
    if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) {
      issues.push({
        path: `$.objectiveWeights.${term}`,
        code: "invalid_objective_weight",
        message: "Objective weight must be a plain decimal string",
      });
      continue;
    }
    values[term] = new Decimal(value);
  }
  if (SOLVER_OBJECTIVE_TERMS.some((term) => values[term] === undefined)) return undefined;
  return values;
}

function blockedReport(
  code: string,
  message: string,
  issues: readonly CompileIssue[] = [],
): CliCompileReport {
  return {
    command: "compile",
    status: "blocked",
    deployableCandidates: [],
    draftCandidates: [],
    failure: { code, message },
    issues,
  };
}

function failedReport(
  code: string,
  message: string,
  issues: readonly CompileIssue[],
): CliCompileReport {
  return {
    command: "compile",
    status: "failed",
    deployableCandidates: [],
    draftCandidates: [],
    failure: { code, message },
    issues,
  };
}

function toCompileIssue(issue: InverseCurveSolverIssue): CompileIssue {
  return {
    path: issue.candidateId === undefined ? "$.solver" : `$.solver.candidates.${issue.candidateId}`,
    code: issue.code,
    message: issue.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ConfigIntegerError extends TypeError {
  readonly path: string;

  constructor(path: string) {
    super("Simulation integer fields must be decimal strings");
    this.path = path;
  }
}
