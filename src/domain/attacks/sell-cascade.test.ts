import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../../examples/demo-market.js";
import { executeBuy, quoteBuy } from "../simulator.js";
import type { AgentCounts } from "../simulation.js";
import type { SellCascadeAttackInput } from "./sell-cascade.js";
import { runSellCascadeAttack } from "./sell-cascade.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeInput(overrides: Partial<SellCascadeAttackInput> = {}): SellCascadeAttackInput {
  const emptyState = createDemoPoolState();
  const warmupQuoteAtomic = 10_000_000_000n;
  const warmup = quoteBuy(warmupQuoteAtomic, emptyState);
  const initialState = executeBuy(warmupQuoteAtomic, emptyState);
  const actorBaseAtomic = warmup.output.amount.raw / 2n;
  const actorCostBasisAtomic = warmup.consumedInput.amount.raw / 2n;

  return {
    id: "sell-cascade-fixture",
    randomSeed: 91n,
    requestedIterations: 3n,
    initialState,
    cascadeAgentDistribution: {
      counts: { ...zeroCounts, "profit-taker": 1n, "panic-seller": 1n },
      templates: {
        "profit-taker": {
          id: "profit",
          archetype: "profit-taker",
          initialQuoteBalanceAtomic: 1_000_000_000n,
          initialBaseBalanceAtomic: actorBaseAtomic,
          initialBaseCostBasisQuoteAtomic: actorCostBasisAtomic,
          entryTickIndex: 0n,
          buyQuoteAtomic: 1_000_000_000n,
          targetGainBps: 10_000n,
          sellShareBps: 10_000n,
        },
        "panic-seller": {
          id: "panic",
          archetype: "panic-seller",
          initialQuoteBalanceAtomic: 1_000_000_000n,
          initialBaseBalanceAtomic: actorBaseAtomic,
          initialBaseCostBasisQuoteAtomic: actorCostBasisAtomic,
          entryTickIndex: 0n,
          buyQuoteAtomic: 1_000_000_000n,
          drawdownThresholdBps: 1n,
          sellShareBps: 10_000n,
        },
      },
    },
    backgroundAgentDistribution: {
      counts: { ...zeroCounts, "retail-buyer": 1n, whale: 1n },
      templates: {
        "retail-buyer": {
          id: "retail",
          archetype: "retail-buyer",
          initialQuoteBalanceAtomic: 200_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: 10_000_000_000n,
          maximumBuyQuoteAtomic: 10_000_000_000n,
          buyProbabilityBps: 10_000n,
          sellProbabilityBps: 0n,
          sellShareBps: 10_000n,
        },
        whale: {
          id: "background-whale",
          archetype: "whale",
          initialQuoteBalanceAtomic: 100_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          entryTickIndex: 0n,
          buyQuoteAtomic: 100_000_000_000n,
        },
      },
    },
    ticks: { tickCount: 30n, slotsPerTick: 1n, secondsPerTick: 10n },
    ...overrides,
  };
}

describe("sell-cascade attack", () => {
  it("measures consecutive exits against a matched no-cascade migration baseline", () => {
    const input = makeInput();
    const first = runSellCascadeAttack(input);
    const replay = runSellCascadeAttack(input);

    expect(first.status).toBe("completed");
    if (first.status !== "completed" || first.scenario !== "sell-cascade") {
      throw new Error("Expected completed sell-cascade metrics");
    }
    if (replay.status !== "completed" || replay.scenario !== "sell-cascade") {
      throw new Error("Expected completed sell-cascade replay");
    }
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
    expect(first.metrics.maximumDrawdownBps.median).toBeGreaterThan(0n);
    expect(first.metrics.quoteOutflow.median.amount.raw).toBeGreaterThan(0n);
    expect(first.metrics.recoveryQuoteRequired.p95.amount.raw).toBeGreaterThan(0n);
    expect(first.metrics.migrationDelaySeconds.median).toBeGreaterThan(0n);
  });

  it("requires two explicit cascade agents and separates background archetypes", () => {
    expect(() =>
      runSellCascadeAttack(
        makeInput({
          cascadeAgentDistribution: { counts: zeroCounts, templates: {} },
        }),
      ),
    ).toThrow("at least two");
    expect(() =>
      runSellCascadeAttack(
        makeInput({
          backgroundAgentDistribution: {
            counts: { ...zeroCounts, "panic-seller": 1n },
            templates: {},
          },
        }),
      ),
    ).toThrow("cannot contain cascade archetypes");
  });
});
