import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../../examples/demo-market.js";
import type { AgentCounts } from "../simulation.js";
import type { OpeningSniperAttackInput } from "./opening-sniper.js";
import { runOpeningSniperAttack } from "./opening-sniper.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeInput(overrides: Partial<OpeningSniperAttackInput> = {}): OpeningSniperAttackInput {
  return {
    id: "opening-sniper-fixture",
    randomSeed: 73n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    supportingAgentDistribution: {
      counts: { ...zeroCounts, "retail-buyer": 1n },
      templates: {
        "retail-buyer": {
          id: "retail",
          archetype: "retail-buyer",
          initialQuoteBalanceAtomic: 500_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: 10_000_000n,
          maximumBuyQuoteAtomic: 10_000_000n,
          buyProbabilityBps: 10_000n,
          sellProbabilityBps: 0n,
          sellShareBps: 10_000n,
        },
      },
    },
    attacker: {
      id: "sniper",
      initialQuoteBalanceAtomic: 200_000_000n,
      buyQuoteAtomic: 100_000_000n,
      holdTicks: 1n,
      minimumOtherBuyerBaseAtomic: 1n,
      exitShareBps: 10_000n,
    },
    ticks: { tickCount: 4n, slotsPerTick: 1n, secondsPerTick: 1n },
    ...overrides,
  };
}

describe("opening sniper attack", () => {
  it("waits for retail demand, exits once, and produces reproducible metrics", () => {
    const input = makeInput();
    const first = runOpeningSniperAttack(input);
    const replay = runOpeningSniperAttack(input);

    expect(first.status).toBe("completed");
    if (first.status !== "completed") throw new Error("Expected a completed opening-sniper run");
    if (first.scenario !== "opening-sniper") throw new Error("Expected opening-sniper metrics");
    if (replay.status !== "completed") throw new Error("Expected a completed replay");
    if (replay.scenario !== "opening-sniper")
      throw new Error("Expected opening-sniper replay metrics");
    expect(first.scenario).toBe("opening-sniper");
    expect(first.randomSeed).toBe(input.randomSeed);
    expect(first.randomAlgorithm).toBe("splitmix64-v1");
    expect(first.completedIterations).toBe(3n);
    expect(first.iterationOutcomes.map(({ randomSeed }) => randomSeed)).toEqual(
      replay.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );
    expect(first.metrics).toEqual(replay.metrics);
    expect({
      iterationSeeds: first.iterationOutcomes.map(({ randomSeed }) => randomSeed),
      iterationStatuses: first.iterationOutcomes.map(({ status }) => status),
      metrics: first.metrics,
    }).toMatchSnapshot();
    expect(first.metrics.attackerPnlQuote.median.amount.raw).toBeLessThan(0n);
    expect(first.metrics.lateBuyerPriceDisadvantageBps.median).toBeGreaterThan(0n);
    expect(first.metrics.feesPaid.p95.quote.raw).toBeGreaterThan(0n);
  });

  it("retains partial iterations when the configured ticks cannot reach the exit", () => {
    const result = runOpeningSniperAttack(
      makeInput({
        requestedIterations: 1n,
        ticks: { tickCount: 1n, slotsPerTick: 1n, secondsPerTick: 1n },
      }),
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed" || result.scenario !== "opening-sniper") {
      throw new Error("Expected an incomplete attack result");
    }
    expect(result.partialIterations).toBe(1n);
    expect(result.iterationOutcomes[0]?.status).toBe("partial");
    expect(result.iterationOutcomes[0]?.failure?.code).toBe("entry_or_exit_not_observed");
    expect(result.completedIterations).toBe(0n);
  });

  it("requires retail buyers, a bonding pool, and valid attacker funding", () => {
    expect(() =>
      runOpeningSniperAttack(
        makeInput({
          supportingAgentDistribution: { counts: zeroCounts, templates: {} },
        }),
      ),
    ).toThrow("retail buyers");
    expect(() =>
      runOpeningSniperAttack(
        makeInput({ attacker: { ...makeInput().attacker, buyQuoteAtomic: 200_000_001n } }),
      ),
    ).toThrow("exceeds the attacker's quote balance");
  });
});
