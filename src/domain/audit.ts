import type { Decimal } from "decimal.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityMetric, AuditSeverityThreshold } from "./audit-policy.js";
import type { AssetAmount } from "./pool-state.js";

export type AuditSeverity = "LOW" | "MODERATE" | "HIGH";

export type AuditFindingCategory =
  | "price-stability"
  | "concentration"
  | "early-advantage"
  | "sniper-exposure"
  | "exit-liquidity-sensitivity"
  | "migration-fragility"
  | "fee-shock"
  | "surplus-behavior"
  | "post-migration-liquidity";

export type AuditEvidenceSource =
  | "deterministic-simulation"
  | "stochastic-simulation"
  | "adversarial-simulation"
  | "sdk-parity"
  | "on-chain";

export type AuditEvidenceValue =
  | Readonly<{ kind: "amount"; value: AssetAmount }>
  | Readonly<{ kind: "basis-points"; value: bigint }>
  | Readonly<{ kind: "decimal"; value: Decimal }>
  | Readonly<{ kind: "duration-seconds"; value: bigint }>
  | Readonly<{ kind: "count"; value: bigint }>;

export type AuditEvidence = Readonly<{
  source: AuditEvidenceSource;
  reference: string;
  metric: string;
  value: AuditEvidenceValue;
}>;

export type AuditFinding = Readonly<{
  id: string;
  ruleId: string;
  category: AuditFindingCategory;
  severity: AuditSeverity;
  severityMetric: AuditSeverityMetric;
  severityValueBps: bigint;
  severityThresholds: AuditSeverityThreshold;
  severityPolicyId: string;
  severityPolicyVersion: string;
  severityPolicyClassification: AuditSeverityPolicy["classification"];
  title: string;
  summary: string;
  evidence: readonly [AuditEvidence, ...AuditEvidence[]];
  suggestedRemediations: readonly string[];
}>;

export type AuditMetricObservation = Readonly<{
  category: AuditFindingCategory;
  ruleId: string;
  source: AuditEvidenceSource;
  reference: string;
  metric: AuditSeverityMetric;
  valueBps: bigint;
  metricDescription: string;
  supportingEvidence?: readonly AuditEvidence[];
}>;

export type AuditAnalysisStatus = "completed" | "partial" | "unavailable";

export type AuditCategoryResult<Category extends AuditFindingCategory> = Readonly<{
  auditId: string;
  candidateId: string;
  category: Category;
  status: AuditAnalysisStatus;
  evidenceClassification: "modeled";
  severityPolicy: AuditSeverityPolicy;
  observations: readonly AuditMetricObservation[];
  findings: readonly AuditFinding[];
}>;

export type PriceStabilityAuditResult = AuditCategoryResult<"price-stability">;
