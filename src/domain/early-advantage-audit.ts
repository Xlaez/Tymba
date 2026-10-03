import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { StochasticSimulationResult } from "./simulation.js";

export type EarlyAdvantageAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  stochasticRuns: readonly StochasticSimulationResult[];
  policy?: AuditSeverityPolicy;
}>;

export type EarlyAdvantageAuditResult = AuditCategoryResult<"early-advantage">;

export function analyzeEarlyAdvantage(input: EarlyAdvantageAuditInput): EarlyAdvantageAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.stochasticRuns) {
    const distribution = run.summary.earlyParticipantAdvantage;
    const sampleSize = run.summary.earlyParticipantAdvantageSampleSize;
    if (!distribution || sampleSize === undefined || sampleSize === 0n) continue;
    const p95 = distribution.p95;
    observations.push({
      category: "early-advantage",
      ruleId: "early-advantage.first-ten-percent-vs-median-buyer-p95",
      source: "stochastic-simulation",
      reference: run.id,
      metric: "early-buyer-price-advantage-bps",
      valueBps: p95.priceAdvantageBps,
      metricDescription: `p95 per-iteration non-negative first-10%-quote price discount versus the nearest-rank median buyer average price; ${sampleSize} of ${run.completedIterations} completed iterations had sufficient buyer data`,
      supportingEvidence: [
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric:
            "first 10% quote spend average execution price (human quote per human base unit; paired p95-advantage iteration)",
          value: { kind: "decimal", value: p95.firstTenPercentQuoteAveragePrice },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric:
            "nearest-rank median buyer average execution price (human quote per human base unit; paired p95-advantage iteration)",
          value: { kind: "decimal", value: p95.medianBuyerAveragePrice },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric:
            "quote volume in the first 10% tranche (quote atomic amount; paired p95-advantage iteration)",
          value: { kind: "amount", value: p95.quoteVolume },
        },
      ],
    });
  }

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Early-buyer price advantage",
      explanation: `The comparison uses the first 10% of executed quote buy input and the nearest-rank median across buyers in ${observation.source} run ${observation.reference}. It measures modeled price ordering, not participant fairness or future returns.`,
      remediation:
        "Reduce the opening price ramp or add depth to the initial band; trade-off: a smaller early-buyer discount may reduce launch participation incentives or require more quote liquidity.",
    }),
  );
  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "early-advantage",
    status:
      findings.length === 0
        ? "unavailable"
        : input.stochasticRuns.some((run) => run.status === "partial")
          ? "partial"
          : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: EarlyAdvantageAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Early-advantage audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Early-advantage ${name} must be non-empty`);
    }
  }
  if (!Array.isArray(input.stochasticRuns)) {
    throw new TypeError("Early-advantage stochastic runs must be an array");
  }
  if (
    input.stochasticRuns.some((run) => typeof run.id !== "string" || run.id.trim().length === 0)
  ) {
    throw new TypeError("Early-advantage stochastic run references must be non-empty");
  }
}
