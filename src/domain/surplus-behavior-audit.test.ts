import { describe, expect, it } from "vitest";
import { createDemoPoolState, createDemoSimulationInput } from "../../examples/demo-market.js";
import type { AgentCounts } from "./simulation.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import { runDeterministicSimulation } from "./simulator.js";
import { analyzeSurplusBehavior } from "./surplus-behavior-audit.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeGraduatingStochasticRun(id: string) {
  const result = runMonteCarloSimulation({
    id,
    randomSeed: 991n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    agentDistribution: {
      counts: { ...zeroCounts, "retail-buyer": 1n },
      templates: {
        "retail-buyer": {
          id: "retail",
          archetype: "retail-buyer",
          initialQuoteBalanceAtomic: 200_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: 25_000_000_000n,
          maximumBuyQuoteAtomic: 25_000_000_000n,
          buyProbabilityBps: 10_000n,
          sellProbabilityBps: 0n,
          sellShareBps: 10_000n,
        },
      },
    },
    ticks: {
      tickCount: 6n,
      slotsPerTick: 1n,
      secondsPerTick: 1n,
      executionOrder: "configured",
    },
  });
  if (result.status === "failed") throw new Error("Expected a summarized surplus run");
  return result;
}

describe("surplus-behavior audit", () => {
  it("retains deterministic overshoot and each modeled recipient allocation", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "surplus-deterministic-run",
    });
    const result = analyzeSurplusBehavior({
      auditId: "surplus-deterministic-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });
    const finding = result.findings[0];

    expect(result.status).toBe("partial");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.valueBps).toBe(0n);
    expect(finding?.severityMetric).toBe("migration-surplus-bps");
    expect(finding?.severityPolicyVersion).toBe("demo-v1");
    expect(finding?.evidence.map(({ metric }) => metric)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("migration quote threshold"),
        expect.stringContaining("total modeled quote surplus"),
        expect.stringContaining("protocol surplus allocation"),
        expect.stringContaining("partner surplus allocation"),
        expect.stringContaining("creator surplus allocation"),
      ]),
    );
    expect(finding?.summary).toContain("fill-clamp artifact");
    expect(finding?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("summarizes paired p95 overshoot and recipient amounts only across graduated iterations", () => {
    const run = makeGraduatingStochasticRun("surplus-stochastic-run");
    const distribution = run.summary.migrationSurplus;
    expect(run.summary.migrationSurplusSampleSize).toBe(3n);
    if (!distribution) throw new Error("Expected a migration-surplus distribution");
    expect(
      distribution.p95.protocol.amount.raw +
        distribution.p95.partner.amount.raw +
        distribution.p95.creator.amount.raw,
    ).toBe(distribution.p95.overshoot.amount.raw);

    const result = analyzeSurplusBehavior({
      auditId: "surplus-stochastic-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [run],
    });

    expect(result.status).toBe("completed");
    expect(result.observations[0]?.valueBps).toBe(distribution.p95.overshootBps);
    expect(result.observations[0]?.supportingEvidence).toHaveLength(5);
    expect(result.observations[0]?.source).toBe("stochastic-simulation");
  });

  it("does not fabricate a zero surplus observation when migration is not reached", () => {
    const { migrationSettlement: _migrationSettlement, ...simulationInput } =
      createDemoSimulationInput();
    void _migrationSettlement;
    const simulation = runDeterministicSimulation({
      ...simulationInput,
      id: "surplus-not-migrated-run",
      trades: [],
    });
    const result = analyzeSurplusBehavior({
      auditId: "surplus-unavailable-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });

    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
