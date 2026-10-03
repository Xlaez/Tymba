import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { OpeningSniperResult } from "./attack-result.js";
import type { AssetAmount } from "./pool-state.js";

export type OpeningSniperAuditRun = Readonly<{
  result: OpeningSniperResult;
  capitalAtRiskQuote: AssetAmount<"quote">;
}>;

export type SniperExposureAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  openingSniperRuns: readonly OpeningSniperAuditRun[];
  policy?: AuditSeverityPolicy;
}>;

export type SniperExposureAuditResult = AuditCategoryResult<"sniper-exposure">;

export function analyzeSniperExposure(input: SniperExposureAuditInput): SniperExposureAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = input.openingSniperRuns.map(
    ({ result, capitalAtRiskQuote }) => {
      const profitP95 = result.metrics.attackerPnlQuote.p95;
      const rawReturnBps = (profitP95.amount.raw * 10_000n) / capitalAtRiskQuote.amount.raw;
      const valueBps = rawReturnBps > 0n ? rawReturnBps : 0n;
      return {
        category: "sniper-exposure",
        ruleId: "sniper-exposure.opening-attacker-profit-p95",
        source: "adversarial-simulation",
        reference: result.id,
        metric: "sniper-return-bps",
        valueBps,
        metricDescription:
          "p95 modeled opening-sniper quote PnL divided by the explicitly supplied capital-at-risk quote amount; losses map to zero positive return for severity",
        supportingEvidence: [
          {
            source: "adversarial-simulation",
            reference: result.id,
            metric: "p95 attacker quote PnL (signed quote amount)",
            value: { kind: "amount", value: profitP95 },
          },
          {
            source: "adversarial-simulation",
            reference: result.id,
            metric: "explicit opening attack capital-at-risk basis (quote amount)",
            value: { kind: "amount", value: capitalAtRiskQuote },
          },
        ],
      };
    },
  );
  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Opening-sniper profitability",
      explanation: `The p95 profit is normalized by the caller-supplied capital-at-risk amount from adversarial run ${observation.reference}; this result only describes the configured modeled attacker and supporting demand.`,
      remediation:
        "Increase early-curve depth or adjust the opening fee schedule; trade-off: more quote capital may be committed or higher fees may reduce regular-buyer proceeds and participation. This does not guarantee resistance to other attacker strategies.",
    }),
  );
  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "sniper-exposure",
    status:
      findings.length === 0
        ? "unavailable"
        : input.openingSniperRuns.some(({ result }) => result.status === "partial")
          ? "partial"
          : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function validateInput(input: SniperExposureAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Sniper-exposure audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Sniper-exposure ${name} must be non-empty`);
    }
  }
  if (!Array.isArray(input.openingSniperRuns)) {
    throw new TypeError("Sniper-exposure runs must be an array");
  }
  for (const { result, capitalAtRiskQuote } of input.openingSniperRuns) {
    if (typeof result.id !== "string" || result.id.trim().length === 0) {
      throw new TypeError("Sniper-exposure run references must be non-empty");
    }
    if (
      capitalAtRiskQuote?.asset !== "quote" ||
      typeof capitalAtRiskQuote.amount?.raw !== "bigint" ||
      capitalAtRiskQuote.amount.raw <= 0n ||
      capitalAtRiskQuote.amount.decimals !== result.metrics.attackerPnlQuote.p95.amount.decimals
    ) {
      throw new RangeError(
        "Sniper capital-at-risk must be a positive quote amount with matching decimals",
      );
    }
  }
}
