import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { StochasticSimulationResult } from "./simulation.js";
import type { WhaleEntryResult } from "./attack-result.js";

export type ConcentrationAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  stochasticRuns?: readonly StochasticSimulationResult[];
  whaleEntryRuns?: readonly WhaleEntryResult[];
  policy?: AuditSeverityPolicy;
}>;

export type ConcentrationAuditResult = AuditCategoryResult<"concentration">;

export function analyzeConcentration(input: ConcentrationAuditInput): ConcentrationAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.stochasticRuns ?? []) {
    const topHolder = run.summary.topHolderConcentrationBps?.p95;
    if (topHolder !== undefined) {
      observations.push({
        category: "concentration",
        ruleId: "concentration.tracked-top-holder-p95",
        source: "stochastic-simulation",
        reference: run.id,
        metric: "top-holder-concentration-bps",
        valueBps: topHolder,
        metricDescription:
          "p95 top-holder share of tracked configured-agent base balances; unmodeled holders are excluded",
      });
    }

    const topTen = run.summary.topTenHolderConcentrationBps?.p95;
    if (topTen !== undefined) {
      observations.push({
        category: "concentration",
        ruleId: "concentration.tracked-top-ten-p95",
        source: "stochastic-simulation",
        reference: run.id,
        metric: "top-ten-holder-concentration-bps",
        valueBps: topTen,
        metricDescription:
          "p95 top-ten share of tracked configured-agent base balances; unmodeled holders are excluded",
      });
    }
  }

  for (const run of input.whaleEntryRuns ?? []) {
    observations.push({
      category: "concentration",
      ruleId: "concentration.modeled-whale-entry-p95",
      source: "adversarial-simulation",
      reference: run.id,
      metric: "top-holder-concentration-bps",
      valueBps: run.metrics.postBuyConcentrationBps.p95,
      metricDescription:
        "p95 modeled whale share of tracked agent base balances immediately after its configured entry",
    });
  }

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: titleForRule(observation.ruleId),
      explanation: `${observation.metricDescription} from ${observation.source} run ${observation.reference}. This is scenario-bounded concentration evidence, not a measurement of all market wallets.`,
      remediation: recommendationForRule(observation.ruleId),
    }),
  );
  const hasPartialRun =
    (input.stochasticRuns ?? []).some((run) => run.status === "partial") ||
    (input.whaleEntryRuns ?? []).some((run) => run.status === "partial");

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "concentration",
    status: findings.length === 0 ? "unavailable" : hasPartialRun ? "partial" : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: ConcentrationAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Concentration audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Concentration ${name} must be non-empty`);
    }
  }
  for (const [name, value] of [
    ["stochastic", input.stochasticRuns],
    ["whale-entry", input.whaleEntryRuns],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(`Concentration ${name} runs must be an array`);
    }
  }
  const references = [
    ...(input.stochasticRuns ?? []).map((run) => run.id),
    ...(input.whaleEntryRuns ?? []).map((run) => run.id),
  ];
  if (
    references.some((reference) => typeof reference !== "string" || reference.trim().length === 0)
  ) {
    throw new TypeError("Concentration simulation references must be non-empty");
  }
}

function titleForRule(ruleId: string): string {
  if (ruleId === "concentration.tracked-top-holder-p95") return "Tracked top-holder concentration";
  if (ruleId === "concentration.tracked-top-ten-p95") return "Tracked top-ten concentration";
  return "Modeled whale-entry concentration";
}

function recommendationForRule(ruleId: string): string {
  if (ruleId === "concentration.tracked-top-ten-p95") {
    return "Rebalance early distribution and reduce dependence on a small set of large allocations; trade-off: smaller allocations can reduce large-ticket participation or change the target distribution profile.";
  }
  if (ruleId === "concentration.modeled-whale-entry-p95") {
    return "Increase opening-band depth or test a lower whale-entry size; trade-off: deeper liquidity needs more quote capital, while limiting entry size may change migration timing. This does not prevent unmodeled or Sybil wallets.";
  }
  return "Rebalance early distribution across more modeled participants; trade-off: reducing large-holder share can change acquisition behavior and the intended ownership profile. This does not establish concentration across unmodeled wallets.";
}
