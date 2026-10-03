import { Decimal } from "decimal.js";
import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditEvidence } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { FeeScheduleTimingResult } from "./attack-result.js";
import type { PoolState } from "./pool-state.js";
import { getScheduledBaseFeeNumeratorAtClock } from "./simulator.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const FEE_NUMERATOR_PER_BPS = 100_000n;

export type FeeShockAuditRun = Readonly<{
  result: FeeScheduleTimingResult;
  initialState: PoolState;
}>;

export type FeeShockAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  runs: readonly FeeShockAuditRun[];
  policy?: AuditSeverityPolicy;
}>;

export type FeeShockAuditResult = AuditCategoryResult<"fee-shock">;

export function analyzeFeeShock(input: FeeShockAuditInput): FeeShockAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations = input.runs.flatMap(({ result, initialState }) => {
    const candidates = [...result.candidateOutcomes].sort((left, right) =>
      left.candidateIndex < right.candidateIndex
        ? -1
        : left.candidateIndex > right.candidateIndex
          ? 1
          : 0,
    );
    let largestStep:
      | Readonly<{
          before: (typeof candidates)[number];
          after: (typeof candidates)[number];
          beforeNumerator: bigint;
          afterNumerator: bigint;
          exactDeltaBps: Decimal;
          severityValueBps: bigint;
        }>
      | undefined;

    for (let index = 1; index < candidates.length; index += 1) {
      const before = candidates[index - 1];
      const after = candidates[index];
      if (!before || !after) continue;
      const beforeNumerator = getScheduledBaseFeeNumeratorAtClock(initialState, before.entryClock);
      const afterNumerator = getScheduledBaseFeeNumeratorAtClock(initialState, after.entryClock);
      const numeratorDelta = absolute(afterNumerator - beforeNumerator);
      const exactDeltaBps = new ExactDecimal(numeratorDelta.toString()).div(
        FEE_NUMERATOR_PER_BPS.toString(),
      );
      const severityValueBps = BigInt(exactDeltaBps.ceil().toFixed(0));
      if (largestStep === undefined || severityValueBps > largestStep.severityValueBps) {
        largestStep = {
          before,
          after,
          beforeNumerator,
          afterNumerator,
          exactDeltaBps,
          severityValueBps,
        };
      }
    }

    if (!largestStep) return [];
    const { before, after, beforeNumerator, afterNumerator, exactDeltaBps, severityValueBps } =
      largestStep;
    return [
      {
        category: "fee-shock" as const,
        ruleId: "fee-shock.maximum-adjacent-base-fee-step",
        source: "deterministic-simulation" as const,
        reference: result.id,
        metric: "fee-shock-bps" as const,
        valueBps: severityValueBps,
        metricDescription: `largest adjacent scheduled base-fee rate change, rounded up from exact numerator change to whole bps, between timing candidates ${before.candidateIndex} and ${after.candidateIndex}`,
        supportingEvidence: [
          {
            source: "deterministic-simulation" as const,
            reference: result.id,
            metric: `scheduled base-fee numerator before candidate ${before.candidateIndex}`,
            value: {
              kind: "decimal" as const,
              value: new ExactDecimal(beforeNumerator.toString()),
            },
          },
          {
            source: "deterministic-simulation" as const,
            reference: result.id,
            metric: `scheduled base-fee numerator after candidate ${after.candidateIndex}`,
            value: { kind: "decimal" as const, value: new ExactDecimal(afterNumerator.toString()) },
          },
          {
            source: "deterministic-simulation" as const,
            reference: result.id,
            metric:
              "exact absolute scheduled base-fee rate change (basis points before policy rounding)",
            value: { kind: "decimal" as const, value: exactDeltaBps },
          },
          ...feeOutcomeEvidence(result.id, before),
          ...feeOutcomeEvidence(result.id, after),
        ] satisfies readonly AuditEvidence[],
      },
    ];
  });

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Scheduled base-fee discontinuity",
      explanation: `The largest adjacent fee-rate step is computed from the simulator's scheduled base-fee numerator at retained timing candidates. This measures schedule discontinuity, not buyer demand response or SDK/on-chain parity.`,
      remediation:
        "Spread the scheduled fee change over more periods or reduce the adjacent rate step; trade-off: a high starting fee may persist longer, while reducing overall rates may lower fee revenue.",
    }),
  );
  const hasPartialRun = input.runs.some(
    ({ result }) => result.status === "partial" || result.failedCandidates > 0n,
  );

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "fee-shock",
    status: findings.length === 0 ? "unavailable" : hasPartialRun ? "partial" : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function feeOutcomeEvidence(
  runId: string,
  candidate: FeeScheduleTimingResult["candidateOutcomes"][number],
): AuditEvidence[] {
  if (candidate.status !== "completed" || candidate.feesPaid === undefined) return [];
  return [
    {
      source: "deterministic-simulation",
      reference: runId,
      metric: `candidate ${candidate.candidateIndex} round-trip base fees paid`,
      value: {
        kind: "amount",
        value: { asset: "base", amount: candidate.feesPaid.base },
      },
    },
    {
      source: "deterministic-simulation",
      reference: runId,
      metric: `candidate ${candidate.candidateIndex} round-trip quote fees paid`,
      value: {
        kind: "amount",
        value: { asset: "quote", amount: candidate.feesPaid.quote },
      },
    },
  ];
}

function validateInput(input: FeeShockAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Fee-shock audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Fee-shock ${name} must be non-empty`);
    }
  }
  const runs: unknown = input.runs;
  if (!Array.isArray(runs)) throw new TypeError("Fee-shock runs must be an array");
  for (const { result, initialState } of runs as readonly FeeShockAuditRun[]) {
    if (result.id.trim().length === 0)
      throw new TypeError("Fee-shock run reference must be non-empty");
    if (initialState.fees.base.kind === "fixed") {
      throw new RangeError(
        "Fee-shock analysis requires a scheduled linear or exponential base fee",
      );
    }
    if (
      result.candidateOutcomes.length < 2 ||
      result.candidateCount !== BigInt(result.candidateOutcomes.length)
    ) {
      throw new RangeError("Fee-shock analysis requires at least two timing candidates");
    }
    const candidateIndexes = result.candidateOutcomes
      .map(({ candidateIndex }) => candidateIndex)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (candidateIndexes.some((candidateIndex, index) => candidateIndex !== BigInt(index))) {
      throw new RangeError("Fee-shock candidate indexes must be contiguous and unique");
    }
    const scheduledClock = initialState.fees.base.clock;
    const points = [...result.candidateOutcomes].sort((left, right) => {
      const leftPoint =
        scheduledClock === "slot" ? left.entryClock.slot : left.entryClock.timestampSeconds;
      const rightPoint =
        scheduledClock === "slot" ? right.entryClock.slot : right.entryClock.timestampSeconds;
      return leftPoint < rightPoint ? -1 : leftPoint > rightPoint ? 1 : 0;
    });
    if (
      points.some(
        (candidate, index) =>
          index > 0 && candidate.candidateIndex <= (points[index - 1]?.candidateIndex ?? -1n),
      )
    ) {
      throw new RangeError("Fee-shock candidate clocks must increase with candidate indexes");
    }
  }
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
