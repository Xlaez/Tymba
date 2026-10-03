import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { DeterministicSimulationResult, StochasticSimulationResult } from "./simulation.js";

export type SurplusBehaviorAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  deterministicRuns?: readonly DeterministicSimulationResult[];
  stochasticRuns?: readonly StochasticSimulationResult[];
  policy?: AuditSeverityPolicy;
}>;

export type SurplusBehaviorAuditResult = AuditCategoryResult<"surplus-behavior">;

export function analyzeSurplusBehavior(
  input: SurplusBehaviorAuditInput,
): SurplusBehaviorAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.deterministicRuns ?? []) {
    if (run.finalState.migrationProgress === "bonding") continue;
    const threshold = run.initialState.curve.migrationQuoteThresholdAtomic;
    const overshoot =
      run.metrics.surplus.protocol.amount.raw +
      run.metrics.surplus.partner.amount.raw +
      run.metrics.surplus.creator.amount.raw;
    observations.push({
      category: "surplus-behavior",
      ruleId: "surplus-behavior.deterministic-overshoot",
      source: "deterministic-simulation",
      reference: run.id,
      metric: "migration-surplus-bps",
      valueBps: (overshoot * 10_000n) / threshold,
      metricDescription:
        "observed deterministic quote-reserve overshoot relative to the configured migration threshold",
      supportingEvidence: [
        amountEvidence(
          run.id,
          "migration quote threshold",
          threshold,
          run.initialState.curve.quoteDecimals,
        ),
        amountEvidence(
          run.id,
          "total modeled quote surplus",
          overshoot,
          run.initialState.curve.quoteDecimals,
        ),
        amountEvidence(
          run.id,
          "modeled protocol surplus allocation",
          run.metrics.surplus.protocol.amount.raw,
          run.initialState.curve.quoteDecimals,
        ),
        amountEvidence(
          run.id,
          "modeled partner surplus allocation",
          run.metrics.surplus.partner.amount.raw,
          run.initialState.curve.quoteDecimals,
        ),
        amountEvidence(
          run.id,
          "modeled creator surplus allocation",
          run.metrics.surplus.creator.amount.raw,
          run.initialState.curve.quoteDecimals,
        ),
      ],
    });
  }

  for (const run of input.stochasticRuns ?? []) {
    const distribution = run.summary.migrationSurplus;
    const sampleSize = run.summary.migrationSurplusSampleSize;
    if (!distribution || sampleSize === undefined || sampleSize === 0n) continue;
    const p95 = distribution.p95;
    observations.push({
      category: "surplus-behavior",
      ruleId: "surplus-behavior.stochastic-overshoot-p95",
      source: "stochastic-simulation",
      reference: run.id,
      metric: "migration-surplus-bps",
      valueBps: p95.overshootBps,
      metricDescription: `p95 quote-reserve overshoot relative to the migration threshold across ${sampleSize} completed iterations that reached the DBC migration threshold`,
      supportingEvidence: [
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric: "p95 migration threshold",
          value: { kind: "amount", value: p95.threshold },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric: "p95 total quote overshoot",
          value: { kind: "amount", value: p95.overshoot },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric: "p95 protocol surplus allocation",
          value: { kind: "amount", value: p95.protocol },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric: "p95 partner surplus allocation",
          value: { kind: "amount", value: p95.partner },
        },
        {
          source: "stochastic-simulation",
          reference: run.id,
          metric: "p95 creator surplus allocation",
          value: { kind: "amount", value: p95.creator },
        },
      ],
    });
  }

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Migration quote surplus behavior",
      explanation: `The metric is quote surplus as a fraction of the configured migration threshold. Recipient amounts reflect the current simulator's accounting and rounding model; they are not SDK/program parity verified. The simulator caps fills at curve completion, so a zero result may be a fill-clamp artifact rather than evidence that real transactions cannot overshoot. Overshoot can result from trade granularity and is not by itself evidence of loss or protocol risk. Evidence source: ${observation.source} run ${observation.reference}.`,
      remediation:
        "Consider smaller maximum quote inputs near migration or more granular execution around the threshold; trade-off: additional transactions or slower graduation may reduce overshoot. Changing the migration target also changes graduation economics and must preserve the intended migration price and quote target.",
    }),
  );
  const hasPartialRun =
    (input.deterministicRuns ?? []).some((run) => run.status === "partial") ||
    (input.stochasticRuns ?? []).some((run) => run.status === "partial");

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "surplus-behavior",
    status: findings.length === 0 ? "unavailable" : hasPartialRun ? "partial" : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function amountEvidence(
  reference: string,
  metric: string,
  raw: bigint,
  decimals: number,
): NonNullable<AuditMetricObservation["supportingEvidence"]>[number] {
  return {
    source: "deterministic-simulation",
    reference,
    metric: `${metric} in quote-token atomic units`,
    value: {
      kind: "amount",
      value: {
        asset: "quote",
        amount: { raw, decimals },
      },
    },
  };
}

function validateInput(input: SurplusBehaviorAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Surplus-behavior audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Surplus-behavior ${name} must be non-empty`);
    }
  }
  if (input.deterministicRuns !== undefined && !Array.isArray(input.deterministicRuns)) {
    throw new TypeError("Surplus-behavior deterministic runs must be an array");
  }
  if (input.stochasticRuns !== undefined && !Array.isArray(input.stochasticRuns)) {
    throw new TypeError("Surplus-behavior stochastic runs must be an array");
  }
  const references = [
    ...(input.deterministicRuns ?? []).map((run) => run.id),
    ...(input.stochasticRuns ?? []).map((run) => run.id),
  ];
  if (
    references.some((reference) => typeof reference !== "string" || reference.trim().length === 0)
  ) {
    throw new TypeError("Surplus-behavior simulation references must be non-empty");
  }
}
