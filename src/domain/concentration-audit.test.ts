import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { AgentCounts, StochasticSimulationResult } from "./simulation.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import { analyzeConcentration } from "./concentration-audit.js";
import { runWhaleEntryAttack } from "./attacks/whale-entry.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeStochasticRun(withBuyer: boolean): StochasticSimulationResult {
  const result = runMonteCarloSimulation({
    id: withBuyer ? "concentration-agent-run" : "no-holder-run",
    randomSeed: 317n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    agentDistribution: {
      counts: withBuyer ? { ...zeroCounts, "retail-buyer": 1n } : zeroCounts,
      templates: withBuyer
        ? {
            "retail-buyer": {
              id: "retail",
              archetype: "retail-buyer",
              initialQuoteBalanceAtomic: 10_000_000_000n,
              initialBaseBalanceAtomic: 0n,
              initialBaseCostBasisQuoteAtomic: 0n,
              minimumBuyQuoteAtomic: 1_000_000_000n,
              maximumBuyQuoteAtomic: 1_000_000_000n,
              buyProbabilityBps: 10_000n,
              sellProbabilityBps: 0n,
              sellShareBps: 10_000n,
            },
          }
        : {},
    },
    ticks: {
      tickCount: 1n,
      slotsPerTick: 1n,
      secondsPerTick: 1n,
      executionOrder: "configured",
    },
  });
  if (result.status === "failed") throw new Error("Expected a summarized stochastic run");
  return result;
}

function makeWhaleRun() {
  const result = runWhaleEntryAttack({
    id: "concentration-whale-run",
    randomSeed: 81n,
    requestedIterations: 2n,
    initialState: createDemoPoolState(),
    supportingAgentDistribution: { counts: zeroCounts, templates: {} },
    attacker: {
      id: "modeled-whale",
      initialQuoteBalanceAtomic: 20_000_000_000n,
      migrationQuoteShareBps: 1_000n,
      entryTickIndex: 0n,
    },
    ticks: { tickCount: 2n, slotsPerTick: 1n, secondsPerTick: 1n },
  });
  if (result.status !== "completed" || result.scenario !== "whale-entry") {
    throw new Error("Expected a completed whale-entry run");
  }
  return result;
}

describe("concentration audit", () => {
  it("reports tracked top-holder, top-ten, and modeled whale concentration with source scope", () => {
    const stochastic = makeStochasticRun(true);
    const whale = makeWhaleRun();
    const result = analyzeConcentration({
      auditId: "concentration-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [stochastic],
      whaleEntryRuns: [whale],
    });

    expect(result.status).toBe("completed");
    expect(result.observations).toHaveLength(3);
    expect(result.observations.map(({ ruleId }) => ruleId)).toEqual([
      "concentration.tracked-top-holder-p95",
      "concentration.tracked-top-ten-p95",
      "concentration.modeled-whale-entry-p95",
    ]);
    expect(result.observations[0]?.valueBps).toBe(
      stochastic.summary.topHolderConcentrationBps?.p95,
    );
    expect(result.observations[1]?.valueBps).toBe(
      stochastic.summary.topTenHolderConcentrationBps?.p95,
    );
    expect(result.observations[2]?.valueBps).toBe(whale.metrics.postBuyConcentrationBps.p95);
    expect(result.findings[0]?.evidence[0]?.reference).toBe(stochastic.id);
    expect(result.findings[2]?.evidence[0]?.source).toBe("adversarial-simulation");
    expect(
      result.findings.every(({ suggestedRemediations }) =>
        suggestedRemediations[0]?.includes("trade-off:"),
      ),
    ).toBe(true);
    expect(
      result.findings.every(({ summary }) =>
        summary.includes("not a measurement of all market wallets"),
      ),
    ).toBe(true);
  });

  it("returns unavailable when no tracked holder metric exists instead of inventing zero concentration", () => {
    const result = analyzeConcentration({
      auditId: "empty-concentration-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [makeStochasticRun(false)],
    });

    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("retains partial-run status and rejects missing audit identities", () => {
    const run = makeStochasticRun(true);
    const partialRun = { ...run, status: "partial" } as StochasticSimulationResult;
    const result = analyzeConcentration({
      auditId: "partial-concentration-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [partialRun],
    });

    expect(result.status).toBe("partial");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(() => analyzeConcentration({ auditId: "", candidateId: "demo-candidate" })).toThrow(
      "audit id must be non-empty",
    );
  });
});
