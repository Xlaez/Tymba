import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { StochasticSimulationResult } from "./simulation.js";

export type LateStageCapitalStressPair = Readonly<{
  baselineRun: StochasticSimulationResult;
  lateStageStressRun: StochasticSimulationResult;
  lateStageQuoteCapitalReductionBps: bigint;
}>;

export type MigrationFragilityAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  stressPairs: readonly LateStageCapitalStressPair[];
  policy?: AuditSeverityPolicy;
}>;

export type MigrationFragilityAuditResult = AuditCategoryResult<"migration-fragility">;

export function analyzeMigrationFragility(
  input: MigrationFragilityAuditInput,
): MigrationFragilityAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = input.stressPairs.map((pair) => {
    const baselineFrequencyBps = pair.baselineRun.summary.graduationFrequencyBps;
    const stressFrequencyBps = pair.lateStageStressRun.summary.graduationFrequencyBps;
    const failureFrequencyBps = 10_000n - stressFrequencyBps;
    return {
      category: "migration-fragility",
      ruleId: "migration-fragility.late-capital-stress-failure-frequency",
      source: "stochastic-simulation",
      reference: pair.lateStageStressRun.id,
      metric: "migration-failure-frequency-bps",
      valueBps: failureFrequencyBps,
      metricDescription: `graduation failure frequency under a paired, caller-declared ${pair.lateStageQuoteCapitalReductionBps} bps late-stage quote-capital reduction using the same master seed and agent counts`,
      supportingEvidence: [
        {
          source: "stochastic-simulation",
          reference: pair.baselineRun.id,
          metric: "baseline DBC-threshold graduation frequency (basis points)",
          value: { kind: "basis-points", value: baselineFrequencyBps },
        },
        {
          source: "stochastic-simulation",
          reference: pair.lateStageStressRun.id,
          metric: "late-stage-capital-stress DBC-threshold graduation frequency (basis points)",
          value: { kind: "basis-points", value: stressFrequencyBps },
        },
        {
          source: "stochastic-simulation",
          reference: pair.lateStageStressRun.id,
          metric:
            "caller-declared reduction in quote capital available to late-stage buyers (basis points)",
          value: { kind: "basis-points", value: pair.lateStageQuoteCapitalReductionBps },
        },
      ],
    };
  });

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Migration fragility under late-stage capital stress",
      explanation: `The finding reports DBC-threshold graduation failure in the supplied paired simulations. It does not prove that late-stage capital alone caused the outcome; the reduction description is caller-supplied and results remain modeled.`,
      remediation:
        "Increase late-stage buyer depth, improve migration headroom, or reduce reliance on end-of-curve demand; trade-off: additional quote capital or a lower distribution target may be needed, and extending the curve can alter launch economics.",
    }),
  );
  const hasPartialRun = input.stressPairs.some(
    ({ baselineRun, lateStageStressRun }) =>
      baselineRun.status === "partial" || lateStageStressRun.status === "partial",
  );

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "migration-fragility",
    status: findings.length === 0 ? "unavailable" : hasPartialRun ? "partial" : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: MigrationFragilityAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Migration-fragility audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Migration-fragility ${name} must be non-empty`);
    }
  }
  if (!Array.isArray(input.stressPairs)) {
    throw new TypeError("Migration-fragility stress pairs must be an array");
  }
  for (const pair of input.stressPairs) {
    const { baselineRun, lateStageStressRun, lateStageQuoteCapitalReductionBps } = pair;
    if (
      baselineRun.id.trim().length === 0 ||
      lateStageStressRun.id.trim().length === 0 ||
      baselineRun.id === lateStageStressRun.id
    ) {
      throw new TypeError(
        "Migration-fragility paired run references must be distinct and non-empty",
      );
    }
    if (
      typeof lateStageQuoteCapitalReductionBps !== "bigint" ||
      lateStageQuoteCapitalReductionBps <= 0n ||
      lateStageQuoteCapitalReductionBps > 10_000n
    ) {
      throw new RangeError("Late-stage quote-capital reduction must be between 1 and 10000 bps");
    }
    if (
      baselineRun.randomSeed !== lateStageStressRun.randomSeed ||
      baselineRun.randomAlgorithm !== lateStageStressRun.randomAlgorithm ||
      baselineRun.engineVersion !== lateStageStressRun.engineVersion ||
      baselineRun.sdkVersion !== lateStageStressRun.sdkVersion ||
      baselineRun.requestedIterations !== lateStageStressRun.requestedIterations ||
      !sameAgentCounts(baselineRun, lateStageStressRun) ||
      !sameIterationSeeds(baselineRun, lateStageStressRun)
    ) {
      throw new RangeError(
        "Migration-fragility runs must use matching seeds, versions, iteration counts, and agent counts",
      );
    }
    for (const run of [baselineRun, lateStageStressRun]) {
      if (run.summary.graduationFrequencyBps < 0n || run.summary.graduationFrequencyBps > 10_000n) {
        throw new RangeError("Graduation frequency must be within 0 and 10000 basis points");
      }
    }
  }
}

function sameAgentCounts(
  left: StochasticSimulationResult,
  right: StochasticSimulationResult,
): boolean {
  return Object.keys(left.agentCounts).every(
    (key) =>
      left.agentCounts[key as keyof typeof left.agentCounts] ===
      right.agentCounts[key as keyof typeof right.agentCounts],
  );
}

function sameIterationSeeds(
  left: StochasticSimulationResult,
  right: StochasticSimulationResult,
): boolean {
  return (
    left.iterationOutcomes.length === right.iterationOutcomes.length &&
    left.iterationOutcomes.every(
      ({ randomSeed }, index) => randomSeed === right.iterationOutcomes[index]?.randomSeed,
    )
  );
}
