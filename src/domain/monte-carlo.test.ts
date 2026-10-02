import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { AgentCounts } from "./simulation.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import type { MonteCarloSimulationInput } from "./monte-carlo.js";
import { MAX_MVP_AGENT_POPULATION } from "./simulation-scenario.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeInput(overrides: Partial<MonteCarloSimulationInput> = {}): MonteCarloSimulationInput {
  return {
    id: "seeded-monte-carlo",
    randomSeed: 51n,
    requestedIterations: 30n,
    initialState: createDemoPoolState(),
    agentDistribution: {
      counts: { ...zeroCounts, "retail-buyer": 1n },
      templates: {
        "retail-buyer": {
          id: "retail",
          archetype: "retail-buyer",
          initialQuoteBalanceAtomic: 50_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: 500_000_000n,
          maximumBuyQuoteAtomic: 1_000_000_000n,
          buyProbabilityBps: 5_000n,
          sellProbabilityBps: 0n,
          sellShareBps: 10_000n,
        },
      },
    },
    ticks: {
      tickCount: 8n,
      slotsPerTick: 2n,
      secondsPerTick: 15n,
      executionOrder: "seeded-random",
    },
    ...overrides,
  };
}

describe("seeded Monte Carlo simulation", () => {
  it("aggregates reproducible distributions and records every iteration seed", () => {
    const input = makeInput();
    const first = runMonteCarloSimulation(input);
    const replay = runMonteCarloSimulation(input);

    expect(first.status).toBe("completed");
    if (first.status !== "completed") throw new Error("Expected a completed Monte Carlo run");
    if (replay.status !== "completed") throw new Error("Expected a replayed Monte Carlo run");
    expect(first.requestedIterations).toBe(30n);
    expect(first.completedIterations).toBe(30n);
    expect(first.partialIterations).toBe(0n);
    expect(first.failedIterations).toBe(0n);
    expect(first.iterationOutcomes).toHaveLength(30);
    expect(first.iterationOutcomes.map(({ randomSeed }) => randomSeed)).toEqual(
      replay.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );
    expect(new Set(first.iterationOutcomes.map(({ randomSeed }) => randomSeed)).size).toBe(30);
    expect(first.summary).toEqual(replay.summary);
    expect(first.summary.quoteAccumulated.p05.amount.raw).toBeLessThanOrEqual(
      first.summary.quoteAccumulated.median.amount.raw,
    );
    expect(first.summary.quoteAccumulated.median.amount.raw).toBeLessThanOrEqual(
      first.summary.quoteAccumulated.p95.amount.raw,
    );
    expect(first.summary.maximumPriceImpactBps.p95).toBeDefined();
    expect(first.summary.feesGenerated.p95).toBeDefined();
    expect(first.uncertainty.requestedSampleSize).toBe(30n);
    expect(first.uncertainty.completedSampleSize).toBe(30n);
    expect(first.uncertainty.completionRateBps).toBe(10_000n);
    expect(["low", "moderate", "high"]).toContain(first.uncertainty.label);
  });

  it("does not turn failed iterations into zero-valued samples", () => {
    const input = makeInput({
      id: "failed-scenario",
      requestedIterations: 3n,
      initialState: {
        ...createDemoPoolState(),
        hasSwapped: 1 as unknown as boolean,
      },
    });
    const result = runMonteCarloSimulation(input);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected a failed Monte Carlo result");
    expect(result.completedIterations).toBe(0n);
    expect(result.failedIterations).toBe(3n);
    expect(result.iterationOutcomes.every(({ status }) => status === "failed")).toBe(true);
    expect(
      result.iterationOutcomes.every(({ failure }) => failure?.code === "iteration_failed"),
    ).toBe(true);
    expect(result.uncertainty.label).toBe("insufficient-data");
    expect(result.failure.code).toBe("no_completed_iterations");
    expect("summary" in result).toBe(false);
  });

  it("labels fewer than 30 completed iterations as insufficient data", () => {
    const result = runMonteCarloSimulation(makeInput({ requestedIterations: 1n }));

    expect(result.status).toBe("completed");
    expect(result.uncertainty.label).toBe("insufficient-data");
    expect(result.uncertainty.reasons).toContain("fewer-than-30-completed-runs");
    if (result.status !== "completed") throw new Error("Expected a completed Monte Carlo run");
    expect(result.summary.quoteAccumulated.p05).toEqual(result.summary.quoteAccumulated.median);
    expect(result.summary.quoteAccumulated.median).toEqual(result.summary.quoteAccumulated.p95);
  });

  it("summarizes graduation timing, drawdown, holder concentration, fees, and trade impact", () => {
    const result = runMonteCarloSimulation(
      makeInput({
        id: "graduation-metrics",
        requestedIterations: 2n,
        agentDistribution: {
          counts: { ...zeroCounts, whale: 1n },
          templates: {
            whale: {
              id: "whale",
              archetype: "whale",
              initialQuoteBalanceAtomic: 200_000_000_000n,
              initialBaseBalanceAtomic: 0n,
              initialBaseCostBasisQuoteAtomic: 0n,
              entryTickIndex: 0n,
              buyQuoteAtomic: 200_000_000_000n,
            },
          },
        },
      }),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected a completed Monte Carlo run");
    expect(result.summary.graduationFrequencyBps).toBe(10_000n);
    expect(result.summary.timeToMigrationSeconds?.median).toBe(15n);
    expect(result.summary.maximumDrawdownBps.median).toBe(0n);
    expect(result.summary.maximumPriceImpactBps.median).toBeGreaterThan(0n);
    expect(result.summary.topHolderConcentrationBps?.median).toBe(10_000n);
    expect(result.summary.topTenHolderConcentrationBps?.median).toBe(10_000n);
    expect(result.summary.feesGenerated.p95.base.raw).toBeGreaterThan(0n);
    expect(result.summary.creatorFees?.p95.base.raw).toBeGreaterThan(0n);
  });

  it("requires an explicit positive iteration count within the MVP resource cap", () => {
    expect(() => runMonteCarloSimulation(makeInput({ requestedIterations: 0n }))).toThrow(
      "between 1 and",
    );
    expect(() => runMonteCarloSimulation(makeInput({ requestedIterations: 10_001n }))).toThrow(
      "between 1 and",
    );
    expect(() =>
      runMonteCarloSimulation(
        makeInput({
          agentDistribution: {
            counts: { ...zeroCounts, whale: MAX_MVP_AGENT_POPULATION + 1n },
            templates: {
              whale: {
                id: "whale",
                archetype: "whale",
                initialQuoteBalanceAtomic: 1n,
                initialBaseBalanceAtomic: 0n,
                initialBaseCostBasisQuoteAtomic: 0n,
                entryTickIndex: 0n,
                buyQuoteAtomic: 1n,
              },
            },
          },
        }),
      ),
    ).toThrow("MVP limit");
  });
});
