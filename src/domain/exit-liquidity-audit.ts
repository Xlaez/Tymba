import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { OpeningSniperResult, PumpAndDumpResult, SellCascadeResult } from "./attack-result.js";

export type ExitLiquidityAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  openingSniperRuns?: readonly OpeningSniperResult[];
  pumpAndDumpRuns?: readonly PumpAndDumpResult[];
  sellCascadeRuns?: readonly SellCascadeResult[];
  policy?: AuditSeverityPolicy;
}>;

export type ExitLiquidityAuditResult = AuditCategoryResult<"exit-liquidity-sensitivity">;

export function analyzeExitLiquiditySensitivity(
  input: ExitLiquidityAuditInput,
): ExitLiquidityAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.openingSniperRuns ?? []) {
    observations.push({
      category: "exit-liquidity-sensitivity",
      ruleId: "exit-liquidity.opening-sniper-drawdown-p95",
      source: "adversarial-simulation",
      reference: run.id,
      metric: "maximum-drawdown-bps",
      valueBps: run.metrics.drawdownAfterExitBps.p95,
      metricDescription: "p95 maximum observed spot drawdown after the modeled opening-sniper exit",
    });
  }

  for (const run of input.pumpAndDumpRuns ?? []) {
    observations.push({
      category: "exit-liquidity-sensitivity",
      ruleId: "exit-liquidity.pump-and-dump-drawdown-p95",
      source: "adversarial-simulation",
      reference: run.id,
      metric: "maximum-drawdown-bps",
      valueBps: run.metrics.peakToTroughDrawdownBps.p95,
      metricDescription:
        "p95 peak-to-trough price drawdown from a configured pump-and-dump scenario",
      supportingEvidence: [
        {
          source: "adversarial-simulation",
          reference: run.id,
          metric:
            "p95 quote input required to recover the observed post-exit spot-price peak; separately summarized percentile",
          value: { kind: "amount", value: run.metrics.recoveryQuoteRequired.p95 },
        },
        {
          source: "adversarial-simulation",
          reference: run.id,
          metric: "p95 modeled late-buyer mark-to-market loss (basis points)",
          value: { kind: "basis-points", value: run.metrics.lateBuyerLossBps.p95 },
        },
      ],
    });
  }

  for (const run of input.sellCascadeRuns ?? []) {
    observations.push({
      category: "exit-liquidity-sensitivity",
      ruleId: "exit-liquidity.sell-cascade-drawdown-p95",
      source: "adversarial-simulation",
      reference: run.id,
      metric: "maximum-drawdown-bps",
      valueBps: run.metrics.maximumDrawdownBps.p95,
      metricDescription: "p95 maximum spot drawdown during a paired, seeded sell-cascade scenario",
      supportingEvidence: [
        {
          source: "adversarial-simulation",
          reference: run.id,
          metric:
            "p95 quote input required immediately after the cascade to recover the pre-cascade peak; separately summarized percentile",
          value: { kind: "amount", value: run.metrics.recoveryQuoteRequired.p95 },
        },
        {
          source: "adversarial-simulation",
          reference: run.id,
          metric: "p95 quote outflow received by cascade agents",
          value: { kind: "amount", value: run.metrics.quoteOutflow.p95 },
        },
      ],
    });
  }

  const findings = observations.map((observation) => {
    const title = titleForRule(observation.ruleId);
    return createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title,
      explanation: `${observation.metricDescription} in adversarial simulation ${observation.reference}. Recovery/outflow percentiles, when present, are independently summarized and are not asserted to come from the same iteration as the drawdown percentile.`,
      remediation: recommendationForRule(observation.ruleId),
    });
  });
  const runs = [
    ...(input.openingSniperRuns ?? []),
    ...(input.pumpAndDumpRuns ?? []),
    ...(input.sellCascadeRuns ?? []),
  ];

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "exit-liquidity-sensitivity",
    status:
      findings.length === 0
        ? "unavailable"
        : runs.some((run) => run.status === "partial")
          ? "partial"
          : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: ExitLiquidityAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Exit-liquidity audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Exit-liquidity ${name} must be non-empty`);
    }
  }
  for (const [name, value] of [
    ["opening-sniper", input.openingSniperRuns],
    ["pump-and-dump", input.pumpAndDumpRuns],
    ["sell-cascade", input.sellCascadeRuns],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(`Exit-liquidity ${name} runs must be an array`);
    }
    if (value?.some((run) => typeof run.id !== "string" || run.id.trim().length === 0)) {
      throw new TypeError(`Exit-liquidity ${name} references must be non-empty`);
    }
  }
}

function titleForRule(ruleId: string): string {
  if (ruleId === "exit-liquidity.opening-sniper-drawdown-p95") {
    return "Price drawdown after opening-sniper exit";
  }
  if (ruleId === "exit-liquidity.pump-and-dump-drawdown-p95") {
    return "Price drawdown after modeled pump-and-dump";
  }
  return "Price drawdown during modeled sell cascade";
}

function recommendationForRule(ruleId: string): string {
  if (ruleId === "exit-liquidity.opening-sniper-drawdown-p95") {
    return "Increase depth near the modeled sniper exit or adjust the opening curve; trade-off: more quote capital may be needed and entry incentives or migration timing may change.";
  }
  if (ruleId === "exit-liquidity.pump-and-dump-drawdown-p95") {
    return "Increase sell-side depth in the traversed bands or tune fee timing; trade-off: this may require more quote capital, increase buyer fees, or delay migration.";
  }
  return "Increase depth across the cascade's sell bands and revisit migration headroom; trade-off: more quote capital may be required and graduation may become slower or less certain.";
}
