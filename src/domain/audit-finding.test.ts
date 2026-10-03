import { describe, expect, it } from "vitest";
import { DEMO_AUDIT_SEVERITY_POLICY } from "./audit-policy.js";
import { createAuditFinding } from "./audit-finding.js";
import type { CreateAuditFindingInput } from "./audit-finding.js";

const input: CreateAuditFindingInput = {
  auditId: "finding-test",
  policy: DEMO_AUDIT_SEVERITY_POLICY,
  observation: {
    category: "sniper-exposure",
    ruleId: "sniper-exposure.opening-attacker-profit-p95",
    source: "adversarial-simulation",
    reference: "seeded-sniper-run",
    metric: "sniper-return-bps",
    valueBps: 1_000n,
    metricDescription: "Opening-sniper quote return",
  },
  title: "Opening-sniper profitability",
  explanation: "The result is limited to the configured scenario.",
  remediation:
    "Increase early depth; trade-off: more quote capital may be committed before migration.",
};

describe("audit finding recommendations", () => {
  it("requires an explicit economic trade-off in every recommendation", () => {
    const finding = createAuditFinding(input);

    expect(finding.suggestedRemediations[0]).toContain("trade-off:");
    expect(finding).not.toHaveProperty("score");
    expect(finding).not.toHaveProperty("riskScore");
    expect(finding).not.toHaveProperty("safetyScore");
    expect(() => createAuditFinding({ ...input, remediation: "Increase early depth." })).toThrow(
      "economic trade-off",
    );
  });
});
