import { createDemoSimulationInput } from "../../examples/demo-market.js";
import { runDeterministicSimulation } from "./simulator.js";
import { analyzePriceStability } from "./price-stability-audit.js";
import { describe, expect, it } from "vitest";
import { DEMO_AUDIT_SEVERITY_POLICY } from "./audit-policy.js";

describe("price-stability audit", () => {
  it("reports raw early, middle, and late trade impacts with exact run evidence", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "price-stability-demo-run",
    });
    const result = analyzePriceStability({
      auditId: "price-stability-demo-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });

    expect(result.status).toBe("partial");
    expect(result.evidenceClassification).toBe("modeled");
    expect(result.severityPolicy).toEqual(DEMO_AUDIT_SEVERITY_POLICY);
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("riskScore");
    expect(result).not.toHaveProperty("safetyScore");
    expect(result.observations.map(({ metric }) => metric)).toContain("early-price-impact-bps");
    expect(result.observations.map(({ metric }) => metric)).toContain("mid-price-impact-bps");
    expect(result.observations.map(({ metric }) => metric)).toContain("late-price-impact-bps");
    expect(result.findings).toHaveLength(result.observations.length);
    for (const finding of result.findings) {
      expect(finding.severityMetric).toBe(
        finding.evidence[0]?.value.kind === "basis-points"
          ? result.observations.find(({ ruleId }) => ruleId === finding.ruleId)?.metric
          : undefined,
      );
      expect(finding.severityValueBps).toBe(
        finding.evidence[0]?.value.kind === "basis-points"
          ? finding.evidence[0].value.value
          : undefined,
      );
      expect(finding.severityPolicyId).toBe("demo");
      expect(finding.severityPolicyVersion).toBe("demo-v1");
      expect(finding.severityPolicyClassification).toBe("illustrative-demo-heuristic");
      expect(finding.evidence[0]?.reference).toBe(simulation.id);
      expect(finding.summary).toContain("Evidence is modeled");
      expect(finding.suggestedRemediations[0]).toContain("trade-off:");
    }
  });

  it("returns unavailable rather than fabricated zero metrics when there are no observations", () => {
    const { migrationSettlement, ...simulationInput } = createDemoSimulationInput();
    expect(migrationSettlement).toBeDefined();
    const simulation = runDeterministicSimulation({
      ...simulationInput,
      id: "empty-price-stability-run",
      trades: [],
    });
    const result = analyzePriceStability({
      auditId: "empty-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });

    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("uses edited numeric policy thresholds without changing underlying observations", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "custom-policy-run",
    });
    const policy = {
      ...DEMO_AUDIT_SEVERITY_POLICY,
      version: "demo-v2",
      thresholds: {
        ...DEMO_AUDIT_SEVERITY_POLICY.thresholds,
        "early-price-impact-bps": {
          moderateAtOrAboveBps: 0n,
          highAtOrAboveBps: 1n,
        },
      },
    };
    const result = analyzePriceStability({
      auditId: "custom-policy-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
      policy,
    });
    const earlyObservation = result.observations.find(
      ({ metric }) => metric === "early-price-impact-bps",
    );
    const earlyFinding = result.findings.find(
      ({ severityMetric }) => severityMetric === "early-price-impact-bps",
    );

    expect(earlyObservation?.valueBps).toBeGreaterThan(0n);
    expect(earlyFinding?.severity).toBe("HIGH");
    expect(earlyFinding?.severityPolicyVersion).toBe("demo-v2");
    expect(earlyFinding?.severityValueBps).toBe(earlyObservation?.valueBps);
  });

  it("rejects missing audit identity and candidate identity", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "validation-run",
    });

    expect(() =>
      analyzePriceStability({
        auditId: " ",
        candidateId: "demo-candidate",
        deterministicRuns: [simulation],
      }),
    ).toThrow("audit id must be non-empty");
    expect(() =>
      analyzePriceStability({
        auditId: "audit",
        candidateId: "",
        deterministicRuns: [simulation],
      }),
    ).toThrow("candidate id must be non-empty");
  });
});
