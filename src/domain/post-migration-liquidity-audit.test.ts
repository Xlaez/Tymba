import { describe, expect, it } from "vitest";
import { createDemoSimulationInput } from "../../examples/demo-market.js";
import type { DeterministicSimulationResult } from "./simulation.js";
import { runDeterministicSimulation } from "./simulator.js";
import { DEMO_AUDIT_SEVERITY_POLICY } from "./audit-policy.js";
import { analyzePostMigrationLiquidity } from "./post-migration-liquidity-audit.js";

describe("post-migration-liquidity audit", () => {
  it("reports unlocked, vesting, and permanent-lock shares with all allocation buckets", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "post-migration-liquidity-run",
    });
    const result = analyzePostMigrationLiquidity({
      auditId: "post-migration-liquidity-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });
    const observation = result.observations[0];
    const finding = result.findings[0];

    expect(result.status).not.toBe("unavailable");
    expect(observation?.valueBps).toBe(6_000n);
    expect(observation?.supportingEvidence).toHaveLength(10);
    expect(
      observation?.supportingEvidence?.some(
        ({ metric, value }) =>
          metric.includes("vesting share") &&
          value.kind === "basis-points" &&
          value.value === 1_000n,
      ),
    ).toBe(true);
    expect(
      observation?.supportingEvidence?.some(
        ({ metric, value }) =>
          metric.includes("permanently locked share") &&
          value.kind === "basis-points" &&
          value.value === 3_000n,
      ),
    ).toBe(true);
    expect(finding?.severityMetric).toBe("unlocked-post-migration-liquidity-bps");
    expect(finding?.severity).toBe("MODERATE");
    expect(finding?.severityPolicyVersion).toBe("demo-v1");
    expect(finding?.summary).toContain(
      "not a claim that more locked liquidity is always preferable",
    );
    expect(finding?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("uses policy thresholds without changing the measured unlocked share", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "post-migration-custom-policy-run",
    });
    const policy = {
      ...DEMO_AUDIT_SEVERITY_POLICY,
      version: "demo-v2",
      thresholds: {
        ...DEMO_AUDIT_SEVERITY_POLICY.thresholds,
        "unlocked-post-migration-liquidity-bps": {
          moderateAtOrAboveBps: 1n,
          highAtOrAboveBps: 5_000n,
        },
      },
    };
    const result = analyzePostMigrationLiquidity({
      auditId: "post-migration-custom-policy-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
      policy,
    });

    expect(result.observations[0]?.valueBps).toBe(6_000n);
    expect(result.findings[0]?.severity).toBe("HIGH");
    expect(result.findings[0]?.severityPolicyVersion).toBe("demo-v2");
  });

  it("reports unavailable when migration allocation was not produced", () => {
    const { migrationSettlement: _migrationSettlement, ...input } = createDemoSimulationInput();
    void _migrationSettlement;
    const simulation = runDeterministicSimulation({
      ...input,
      id: "post-migration-allocation-unavailable-run",
      trades: [],
    });
    const result = analyzePostMigrationLiquidity({
      auditId: "post-migration-allocation-unavailable-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });

    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("rejects allocation buckets that do not conserve distributable liquidity units", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "post-migration-invalid-allocation-run",
    });
    const allocation = simulation.metrics.liquidityAllocation;
    if (!allocation) throw new Error("Expected demo migration allocation");
    const malformed = {
      ...simulation,
      metrics: {
        ...simulation.metrics,
        liquidityAllocation: {
          ...allocation,
          creator: { ...allocation.creator, unlocked: allocation.creator.unlocked + 1n },
        },
      },
    } as DeterministicSimulationResult;

    expect(() =>
      analyzePostMigrationLiquidity({
        auditId: "post-migration-invalid-allocation-audit",
        candidateId: "demo-candidate",
        deterministicRuns: [malformed],
      }),
    ).toThrow("do not conserve units");
  });
});
