import { describe, expect, it } from "vitest";
import {
  assessAuditSeverity,
  AUDIT_SEVERITY_METRICS,
  DEMO_AUDIT_SEVERITY_POLICY,
  validateAuditSeverityPolicy,
} from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";

describe("versioned audit severity policy", () => {
  it("classifies raw basis-point measurements at explicit editable policy boundaries", () => {
    const metric = "maximum-price-impact-bps";
    const thresholds = DEMO_AUDIT_SEVERITY_POLICY.thresholds[metric];

    expect(assessAuditSeverity(DEMO_AUDIT_SEVERITY_POLICY, metric, 0n).severity).toBe("LOW");
    expect(
      assessAuditSeverity(DEMO_AUDIT_SEVERITY_POLICY, metric, thresholds.moderateAtOrAboveBps)
        .severity,
    ).toBe("MODERATE");
    expect(
      assessAuditSeverity(DEMO_AUDIT_SEVERITY_POLICY, metric, thresholds.highAtOrAboveBps).severity,
    ).toBe("HIGH");
  });

  it("retains policy identity, heuristic label, raw value, and applied thresholds", () => {
    const assessment = assessAuditSeverity(DEMO_AUDIT_SEVERITY_POLICY, "sniper-return-bps", 1_000n);

    expect(assessment).toMatchObject({
      valueBps: 1_000n,
      severity: "MODERATE",
      policyId: "demo",
      policyVersion: "demo-v1",
      classification: "illustrative-demo-heuristic",
      thresholds: { moderateAtOrAboveBps: 500n, highAtOrAboveBps: 1_500n },
    });
    expect(DEMO_AUDIT_SEVERITY_POLICY.label).toContain("not protocol guarantees");
  });

  it("accepts edited thresholds while requiring a complete versioned policy", () => {
    const policy = {
      ...DEMO_AUDIT_SEVERITY_POLICY,
      version: "demo-v2",
      thresholds: {
        ...DEMO_AUDIT_SEVERITY_POLICY.thresholds,
        "sniper-return-bps": {
          moderateAtOrAboveBps: 300n,
          highAtOrAboveBps: 700n,
        },
      },
    };

    expect(assessAuditSeverity(policy, "sniper-return-bps", 700n)).toMatchObject({
      severity: "HIGH",
      policyVersion: "demo-v2",
    });
    const incompletePolicy = {
      ...policy,
      thresholds: {
        "sniper-return-bps": { moderateAtOrAboveBps: 1n, highAtOrAboveBps: 2n },
      },
    } as unknown as AuditSeverityPolicy;
    expect(() => validateAuditSeverityPolicy(incompletePolicy)).toThrow("every supported metric");
    expect(AUDIT_SEVERITY_METRICS).toHaveLength(14);
  });

  it("rejects negative measurements and invalid threshold ordering", () => {
    expect(() =>
      assessAuditSeverity(DEMO_AUDIT_SEVERITY_POLICY, "maximum-drawdown-bps", -1n),
    ).toThrow("non-negative");
    const policy = {
      ...DEMO_AUDIT_SEVERITY_POLICY,
      thresholds: {
        ...DEMO_AUDIT_SEVERITY_POLICY.thresholds,
        "maximum-drawdown-bps": {
          moderateAtOrAboveBps: 2_000n,
          highAtOrAboveBps: 2_000n,
        },
      },
    };
    expect(() => validateAuditSeverityPolicy(policy)).toThrow(
      "Audit severity thresholds are invalid for maximum-drawdown-bps",
    );
  });
});
