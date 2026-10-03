import type { AuditSeverity } from "./audit.js";

export const AUDIT_SEVERITY_METRICS = [
  "early-price-impact-bps",
  "mid-price-impact-bps",
  "late-price-impact-bps",
  "maximum-price-impact-bps",
  "maximum-drawdown-bps",
  "top-holder-concentration-bps",
  "top-ten-holder-concentration-bps",
  "early-buyer-price-advantage-bps",
  "sniper-return-bps",
  "exit-recovery-quote-bps",
  "migration-failure-frequency-bps",
  "fee-shock-bps",
  "migration-surplus-bps",
  "unlocked-post-migration-liquidity-bps",
] as const;

export type AuditSeverityMetric = (typeof AUDIT_SEVERITY_METRICS)[number];

export type AuditSeverityThreshold = Readonly<{
  moderateAtOrAboveBps: bigint;
  highAtOrAboveBps: bigint;
}>;

export type AuditSeverityPolicy = Readonly<{
  id: string;
  version: string;
  classification: "illustrative-demo-heuristic";
  label: string;
  thresholds: Readonly<Record<AuditSeverityMetric, AuditSeverityThreshold>>;
}>;

export type AuditSeverityAssessment = Readonly<{
  metric: AuditSeverityMetric;
  valueBps: bigint;
  severity: AuditSeverity;
  policyId: string;
  policyVersion: string;
  classification: AuditSeverityPolicy["classification"];
  thresholds: AuditSeverityThreshold;
}>;

export const DEMO_AUDIT_SEVERITY_POLICY: AuditSeverityPolicy = Object.freeze({
  id: "demo",
  version: "demo-v1",
  classification: "illustrative-demo-heuristic",
  label: "Illustrative demo thresholds; not protocol guarantees or industry standards",
  thresholds: Object.freeze({
    "early-price-impact-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "mid-price-impact-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "late-price-impact-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "maximum-price-impact-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "maximum-drawdown-bps": Object.freeze({
      moderateAtOrAboveBps: 1_500n,
      highAtOrAboveBps: 3_000n,
    }),
    "top-holder-concentration-bps": Object.freeze({
      moderateAtOrAboveBps: 1_000n,
      highAtOrAboveBps: 2_500n,
    }),
    "top-ten-holder-concentration-bps": Object.freeze({
      moderateAtOrAboveBps: 5_000n,
      highAtOrAboveBps: 7_500n,
    }),
    "early-buyer-price-advantage-bps": Object.freeze({
      moderateAtOrAboveBps: 1_000n,
      highAtOrAboveBps: 2_500n,
    }),
    "sniper-return-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "exit-recovery-quote-bps": Object.freeze({
      moderateAtOrAboveBps: 500n,
      highAtOrAboveBps: 1_500n,
    }),
    "migration-failure-frequency-bps": Object.freeze({
      moderateAtOrAboveBps: 1_000n,
      highAtOrAboveBps: 3_000n,
    }),
    "fee-shock-bps": Object.freeze({
      moderateAtOrAboveBps: 100n,
      highAtOrAboveBps: 500n,
    }),
    "migration-surplus-bps": Object.freeze({
      moderateAtOrAboveBps: 100n,
      highAtOrAboveBps: 500n,
    }),
    "unlocked-post-migration-liquidity-bps": Object.freeze({
      moderateAtOrAboveBps: 5_000n,
      highAtOrAboveBps: 8_000n,
    }),
  }),
});

export function assessAuditSeverity(
  policy: AuditSeverityPolicy,
  metric: AuditSeverityMetric,
  valueBps: bigint,
): AuditSeverityAssessment {
  validateAuditSeverityPolicy(policy);
  if (!AUDIT_SEVERITY_METRICS.includes(metric)) {
    throw new TypeError(`Unsupported audit severity metric: ${String(metric)}`);
  }
  if (typeof valueBps !== "bigint" || valueBps < 0n) {
    throw new RangeError(
      "Audit severity measurement must be a non-negative bigint in basis points",
    );
  }
  const thresholds = policy.thresholds[metric];
  const severity: AuditSeverity =
    valueBps >= thresholds.highAtOrAboveBps
      ? "HIGH"
      : valueBps >= thresholds.moderateAtOrAboveBps
        ? "MODERATE"
        : "LOW";
  return {
    metric,
    valueBps,
    severity,
    policyId: policy.id,
    policyVersion: policy.version,
    classification: policy.classification,
    thresholds,
  };
}

export function validateAuditSeverityPolicy(policy: AuditSeverityPolicy): void {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new TypeError("Audit severity policy must be an object");
  }
  if (typeof policy.id !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(policy.id)) {
    throw new TypeError("Audit severity policy id must be a lowercase identifier");
  }
  if (typeof policy.version !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(policy.version)) {
    throw new TypeError("Audit severity policy version must be a lowercase identifier");
  }
  if (policy.classification !== "illustrative-demo-heuristic") {
    throw new TypeError("Audit severity policy classification must identify its heuristic scope");
  }
  if (typeof policy.label !== "string" || policy.label.trim().length === 0) {
    throw new TypeError("Audit severity policy label must be explicit");
  }
  if (typeof policy.thresholds !== "object" || policy.thresholds === null) {
    throw new TypeError("Audit severity policy thresholds must be an object");
  }
  const actualMetrics = Object.keys(policy.thresholds).sort();
  const expectedMetrics = [...AUDIT_SEVERITY_METRICS].sort();
  if (
    actualMetrics.length !== expectedMetrics.length ||
    actualMetrics.some((metric, index) => metric !== expectedMetrics[index])
  ) {
    throw new TypeError("Audit severity policy must define every supported metric exactly once");
  }
  for (const metric of AUDIT_SEVERITY_METRICS) {
    const threshold = policy.thresholds[metric];
    if (
      typeof threshold !== "object" ||
      threshold === null ||
      typeof threshold.moderateAtOrAboveBps !== "bigint" ||
      typeof threshold.highAtOrAboveBps !== "bigint" ||
      threshold.moderateAtOrAboveBps < 0n ||
      threshold.highAtOrAboveBps <= threshold.moderateAtOrAboveBps
    ) {
      throw new RangeError(`Audit severity thresholds are invalid for ${metric}`);
    }
  }
}
