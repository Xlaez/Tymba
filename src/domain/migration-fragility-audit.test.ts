import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { AgentCounts, StochasticSimulationResult } from "./simulation.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import { analyzeMigrationFragility } from "./migration-fragility-audit.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeRun(id: string, buyQuoteAtomic: bigint, initialQuoteBalanceAtomic: bigint) {
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
          initialQuoteBalanceAtomic,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: buyQuoteAtomic,
          maximumBuyQuoteAtomic: buyQuoteAtomic,
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
  if (result.status === "failed") throw new Error("Expected a summarized migration run");
  return result;
}

describe("migration-fragility audit", () => {
  it("compares paired-seed baseline and late-stage-capital stress graduation frequency", () => {
    const baseline = makeRun("migration-baseline", 25_000_000_000n, 200_000_000_000n);
    const stressed = makeRun("migration-late-capital-stress", 12_500_000_000n, 100_000_000_000n);
    const result = analyzeMigrationFragility({
      auditId: "migration-fragility-audit",
      candidateId: "demo-candidate",
      stressPairs: [
        {
          baselineRun: baseline,
          lateStageStressRun: stressed,
          lateStageQuoteCapitalReductionBps: 5_000n,
        },
      ],
    });

    expect(baseline.randomSeed).toBe(stressed.randomSeed);
    expect(baseline.iterationOutcomes.map(({ randomSeed }) => randomSeed)).toEqual(
      stressed.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );
    expect(baseline.agentCounts).toEqual(stressed.agentCounts);
    expect(baseline.summary.graduationFrequencyBps).toBeGreaterThan(
      stressed.summary.graduationFrequencyBps,
    );
    expect(result.status).toBe("completed");
    expect(result.observations[0]?.valueBps).toBe(
      10_000n - stressed.summary.graduationFrequencyBps,
    );
    expect(result.findings[0]?.severityMetric).toBe("migration-failure-frequency-bps");
    expect(result.findings[0]?.evidence[0]?.reference).toBe(stressed.id);
    expect(result.findings[0]?.evidence[1]?.reference).toBe(baseline.id);
    expect(result.findings[0]?.evidence[2]?.reference).toBe(stressed.id);
    expect(result.findings[0]?.suggestedRemediations[0]).toContain("trade-off:");
    expect(result.findings[0]?.summary).toContain("caller-supplied");
  });

  it("rejects unpaired seeds and invalid late-stage capital assumptions", () => {
    const baseline = makeRun("migration-baseline-validation", 25_000_000_000n, 200_000_000_000n);
    const stressed = makeRun("migration-stress-validation", 12_500_000_000n, 100_000_000_000n);
    const unpaired = { ...stressed, randomSeed: 992n } as StochasticSimulationResult;

    expect(() =>
      analyzeMigrationFragility({
        auditId: "unpaired-audit",
        candidateId: "demo-candidate",
        stressPairs: [
          {
            baselineRun: baseline,
            lateStageStressRun: unpaired,
            lateStageQuoteCapitalReductionBps: 5_000n,
          },
        ],
      }),
    ).toThrow("matching seeds");
    expect(() =>
      analyzeMigrationFragility({
        auditId: "invalid-stress-audit",
        candidateId: "demo-candidate",
        stressPairs: [
          {
            baselineRun: baseline,
            lateStageStressRun: stressed,
            lateStageQuoteCapitalReductionBps: 0n,
          },
        ],
      }),
    ).toThrow("between 1 and 10000 bps");
  });

  it("returns unavailable when no paired stress run is supplied", () => {
    const result = analyzeMigrationFragility({
      auditId: "unavailable-migration-audit",
      candidateId: "demo-candidate",
      stressPairs: [],
    });

    expect(result.status).toBe("unavailable");
    expect(result.findings).toEqual([]);
  });
});
