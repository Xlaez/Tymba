import { assessAuditSeverity } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditEvidence, AuditFinding, AuditMetricObservation } from "./audit.js";

export type CreateAuditFindingInput = Readonly<{
  auditId: string;
  policy: AuditSeverityPolicy;
  observation: AuditMetricObservation;
  title: string;
  explanation: string;
  remediation: string;
}>;

export function createAuditFinding(input: CreateAuditFindingInput): AuditFinding {
  if (typeof input.remediation !== "string" || !/\btrade-off:/i.test(input.remediation)) {
    throw new TypeError("Audit recommendations must state their economic trade-off");
  }
  const { observation, policy } = input;
  const assessment = assessAuditSeverity(policy, observation.metric, observation.valueBps);
  const primaryEvidence: AuditEvidence = {
    source: observation.source,
    reference: observation.reference,
    metric: `${observation.metricDescription} (bps)`,
    value: { kind: "basis-points", value: observation.valueBps },
  };
  const evidence = [primaryEvidence, ...(observation.supportingEvidence ?? [])] as readonly [
    AuditEvidence,
    ...AuditEvidence[],
  ];
  return {
    id: `${input.auditId}:${observation.reference}:${observation.ruleId}`,
    ruleId: observation.ruleId,
    category: observation.category,
    severity: assessment.severity,
    severityMetric: assessment.metric,
    severityValueBps: assessment.valueBps,
    severityThresholds: assessment.thresholds,
    severityPolicyId: assessment.policyId,
    severityPolicyVersion: assessment.policyVersion,
    severityPolicyClassification: assessment.classification,
    title: input.title,
    summary: `${input.title}: ${formatBpsAsPercent(observation.valueBps)}% (${observation.valueBps} bps). ${input.explanation} Evidence is modeled, not an on-chain result or guarantee.`,
    evidence,
    suggestedRemediations: [input.remediation],
  };
}

export function formatBpsAsPercent(valueBps: bigint): string {
  const whole = valueBps / 100n;
  const fractional = (valueBps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fractional.length === 0 ? whole.toString() : `${whole}.${fractional}`;
}
