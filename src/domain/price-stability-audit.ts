import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityMetric, AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditMetricObservation, PriceStabilityAuditResult } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { DeterministicSimulationResult, StochasticSimulationResult } from "./simulation.js";
import type { TradeResult } from "./trade-result.js";

const STAGE_METRICS = [
  {
    metric: "early-price-impact-bps",
    ruleId: "price-stability.early-impact",
    label: "early-curve",
    title: "Early-curve price sensitivity",
    description: "maximum single-trade price impact in early-curve trades",
    lowerProgressBps: 0n,
    upperProgressBps: 3_334n,
  },
  {
    metric: "mid-price-impact-bps",
    ruleId: "price-stability.mid-impact",
    label: "mid-curve",
    title: "Mid-curve price sensitivity",
    description: "maximum single-trade price impact in mid-curve trades",
    lowerProgressBps: 3_334n,
    upperProgressBps: 6_667n,
  },
  {
    metric: "late-price-impact-bps",
    ruleId: "price-stability.late-impact",
    label: "late-curve",
    title: "Late-curve price sensitivity",
    description: "maximum single-trade price impact in late-curve trades",
    lowerProgressBps: 6_667n,
    upperProgressBps: 10_001n,
  },
] as const satisfies readonly {
  metric: AuditSeverityMetric;
  ruleId: string;
  label: string;
  title: string;
  description: string;
  lowerProgressBps: bigint;
  upperProgressBps: bigint;
}[];

export type PriceStabilityAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  deterministicRuns: readonly DeterministicSimulationResult[];
  stochasticRuns?: readonly StochasticSimulationResult[];
  policy?: AuditSeverityPolicy;
}>;

export function analyzePriceStability(input: PriceStabilityAuditInput): PriceStabilityAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.deterministicRuns) {
    const stageMaxima = new Map<
      AuditSeverityMetric,
      Readonly<{ impactBps: bigint; trade: TradeResult; tradeIndex: number }>
    >();
    for (const [tradeIndex, trade] of run.trades.entries()) {
      const progressMidpointBps =
        (trade.metrics.migrationProgressBeforeBps + trade.metrics.migrationProgressAfterBps) / 2n;
      const stage = STAGE_METRICS.find(
        ({ lowerProgressBps, upperProgressBps }) =>
          progressMidpointBps >= lowerProgressBps && progressMidpointBps < upperProgressBps,
      );
      if (!stage) continue;
      const previous = stageMaxima.get(stage.metric);
      if (previous === undefined || trade.metrics.priceImpactBps > previous.impactBps) {
        stageMaxima.set(stage.metric, {
          impactBps: trade.metrics.priceImpactBps,
          trade,
          tradeIndex,
        });
      }
    }

    for (const stage of STAGE_METRICS) {
      const maximum = stageMaxima.get(stage.metric);
      if (maximum === undefined) continue;
      observations.push({
        category: "price-stability",
        ruleId: stage.ruleId,
        source: "deterministic-simulation",
        reference: run.id,
        metric: stage.metric,
        valueBps: maximum.impactBps,
        metricDescription: `${stage.description}; trade stage assigned by midpoint migration progress`,
        supportingEvidence: [
          {
            source: "deterministic-simulation",
            reference: run.id,
            metric: "maximum-impact source trade ordinal",
            value: { kind: "count", value: BigInt(maximum.tradeIndex) },
          },
          {
            source: "deterministic-simulation",
            reference: run.id,
            metric: `maximum-impact ${maximum.trade.direction} trade requested input`,
            value: { kind: "amount", value: maximum.trade.requestedInput },
          },
        ],
      });
    }

    if (run.trades.length > 0) {
      observations.push({
        category: "price-stability",
        ruleId: "price-stability.maximum-drawdown",
        source: "deterministic-simulation",
        reference: run.id,
        metric: "maximum-drawdown-bps",
        valueBps: run.metrics.maximumDrawdownBps,
        metricDescription: "maximum observed peak-to-later-spot-price drawdown",
      });
    }
  }

  for (const run of input.stochasticRuns ?? []) {
    observations.push(
      {
        category: "price-stability",
        ruleId: "price-stability.stochastic-price-impact-p95",
        source: "stochastic-simulation",
        reference: run.id,
        metric: "maximum-price-impact-bps",
        valueBps: run.summary.maximumPriceImpactBps.p95,
        metricDescription: "p95 of per-iteration maximum single-trade price impact",
      },
      {
        category: "price-stability",
        ruleId: "price-stability.stochastic-drawdown-p95",
        source: "stochastic-simulation",
        reference: run.id,
        metric: "maximum-drawdown-bps",
        valueBps: run.summary.maximumDrawdownBps.p95,
        metricDescription: "p95 of per-iteration maximum peak-to-later-price drawdown",
      },
    );
  }

  const findings = observations.map((observation) => createFinding(input, policy, observation));
  const hasPartialRun =
    input.deterministicRuns.some((run) => run.status === "partial") ||
    (input.stochasticRuns ?? []).some((run) => run.status === "partial");
  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "price-stability",
    status: findings.length === 0 ? "unavailable" : hasPartialRun ? "partial" : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: PriceStabilityAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Price-stability audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Price-stability ${name} must be non-empty`);
    }
  }
  if (!Array.isArray(input.deterministicRuns)) {
    throw new TypeError("Price-stability deterministic runs must be an array");
  }
  if (input.stochasticRuns !== undefined && !Array.isArray(input.stochasticRuns)) {
    throw new TypeError("Price-stability stochastic runs must be an array");
  }
  const references = [
    ...input.deterministicRuns.map((run) => run.id),
    ...(input.stochasticRuns ?? []).map((run) => run.id),
  ];
  if (
    references.some((reference) => typeof reference !== "string" || reference.trim().length === 0)
  ) {
    throw new TypeError("Price-stability simulation references must be non-empty");
  }
}

function createFinding(
  input: PriceStabilityAuditInput,
  policy: AuditSeverityPolicy,
  observation: AuditMetricObservation,
) {
  const stage = STAGE_METRICS.find(({ metric }) => metric === observation.metric);
  const title = stage?.title ?? titleForMetric(observation.metric);
  return createAuditFinding({
    auditId: input.auditId,
    policy,
    observation,
    title,
    explanation: `${observation.metricDescription} from ${observation.source} run ${observation.reference}.`,
    remediation: recommendationForMetric(observation.metric),
  });
}

function titleForMetric(metric: AuditSeverityMetric): string {
  if (metric === "maximum-price-impact-bps") return "Stochastic trade price impact";
  if (metric === "maximum-drawdown-bps") return "Observed price drawdown";
  return "Price stability measurement";
}

function recommendationForMetric(metric: AuditSeverityMetric): string {
  if (metric === "early-price-impact-bps") {
    return "Increase liquidity in the initial price band or reduce its price step; trade-off: this requires more quote capital or shifts budget away from later bands.";
  }
  if (metric === "mid-price-impact-bps") {
    return "Shift quote liquidity toward the middle price bands; trade-off: moving budget from early or late bands can worsen sensitivity there and may change migration economics.";
  }
  if (metric === "late-price-impact-bps") {
    return "Increase liquidity in late-curve bands; trade-off: more quote capital is committed before migration or less remains for other launch objectives.";
  }
  if (metric === "maximum-drawdown-bps") {
    return "Increase sell-side depth across the bands traversed by the drawdown; trade-off: greater curve liquidity can require more quote capital and rebalance the distribution target.";
  }
  return "Increase depth where high-impact stochastic trades occur; trade-off: additional quote liquidity can increase capital requirements or move budget away from migration and other bands.";
}
