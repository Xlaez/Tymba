import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import { createSeededRandom } from "./seeded-random.js";
import type { SimulationAgentObservation } from "./stochastic-simulation.js";
import { createMvpAgent } from "./simulation-agents.js";

function makeObservation(
  overrides: Omit<Partial<SimulationAgentObservation>, "portfolio"> & {
    portfolio?: Partial<SimulationAgentObservation["portfolio"]>;
  } = {},
): SimulationAgentObservation {
  const state = createDemoPoolState();
  const spotPrice = overrides.spotPrice ?? new Decimal("2");
  return {
    tickIndex: 0n,
    clock: { slot: 1n, timestampSeconds: 1n },
    state,
    spotPrice,
    migrationProgressBps: 0n,
    cumulativeBaseBoughtAtomicByArchetype: {
      "retail-buyer": 0n,
      whale: 0n,
      sniper: 0n,
      "momentum-trader": 0n,
      "profit-taker": 0n,
      "panic-seller": 0n,
      "random-trader": 0n,
    },
    ...overrides,
    portfolio: {
      quoteBalanceAtomic: 1_000_000n,
      baseBalanceAtomic: 10_000n,
      baseCostBasisQuoteAtomic: 10_000n,
      successfulBuyCount: 1n,
      successfulSellCount: 0n,
      firstBuyTickIndex: 0n,
      averageEntryPrice: new Decimal("1"),
      peakSpotPrice: new Decimal("2"),
      ...overrides.portfolio,
    },
  };
}

const funding = {
  id: "agent",
  initialQuoteBalanceAtomic: 1_000_000n,
  initialBaseBalanceAtomic: 0n,
  initialBaseCostBasisQuoteAtomic: 0n,
};

describe("MVP simulation agents", () => {
  it("models retail entry and probabilistic exits with configured sizes", () => {
    const agent = createMvpAgent({
      ...funding,
      archetype: "retail-buyer",
      minimumBuyQuoteAtomic: 20n,
      maximumBuyQuoteAtomic: 20n,
      buyProbabilityBps: 10_000n,
      sellProbabilityBps: 10_000n,
      sellShareBps: 5_000n,
    });
    const decide = agent.decide;

    expect(
      decide(
        makeObservation({
          portfolio: {
            quoteBalanceAtomic: 100n,
            baseBalanceAtomic: 0n,
            baseCostBasisQuoteAtomic: 0n,
            successfulBuyCount: 0n,
            peakSpotPrice: new Decimal("2"),
          },
        }),
        createSeededRandom(1n),
      ),
    ).toEqual({ kind: "buy", inputAtomic: 20n });
    expect(
      decide(
        makeObservation({
          portfolio: {
            quoteBalanceAtomic: 80n,
            baseBalanceAtomic: 11n,
            baseCostBasisQuoteAtomic: 20n,
            successfulBuyCount: 1n,
            averageEntryPrice: new Decimal("1"),
            peakSpotPrice: new Decimal("2"),
          },
        }),
        createSeededRandom(1n),
      ),
    ).toEqual({ kind: "sell", inputAtomic: 5n });
  });

  it("fires whale and sniper entries at configured ticks and holds", () => {
    const whale = createMvpAgent({
      ...funding,
      archetype: "whale",
      entryTickIndex: 2n,
      buyQuoteAtomic: 500n,
    });
    const unentered = {
      ...makeObservation(),
      portfolio: {
        quoteBalanceAtomic: 1_000_000n,
        baseBalanceAtomic: 0n,
        baseCostBasisQuoteAtomic: 0n,
        successfulBuyCount: 0n,
        successfulSellCount: 0n,
        peakSpotPrice: new Decimal("2"),
      },
    };
    expect(whale.decide({ ...unentered, tickIndex: 1n }, createSeededRandom(2n))).toEqual({
      kind: "wait",
    });
    expect(whale.decide({ ...unentered, tickIndex: 2n }, createSeededRandom(2n))).toEqual({
      kind: "buy",
      inputAtomic: 500n,
    });

    const sniper = createMvpAgent({
      ...funding,
      archetype: "sniper",
      buyQuoteAtomic: 300n,
      holdTicks: 2n,
      minimumOtherBuyerBaseAtomic: 5n,
      exitShareBps: 10_000n,
    });
    expect(sniper.decide({ ...unentered, tickIndex: 0n }, createSeededRandom(3n))).toEqual({
      kind: "buy",
      inputAtomic: 300n,
    });
    expect(
      sniper.decide(
        {
          ...unentered,
          tickIndex: 2n,
          portfolio: {
            ...unentered.portfolio,
            baseBalanceAtomic: 10_000n,
            successfulBuyCount: 1n,
            successfulSellCount: 0n,
            firstBuyTickIndex: 0n,
          },
          cumulativeBaseBoughtAtomicByArchetype: {
            ...unentered.cumulativeBaseBoughtAtomicByArchetype,
            "retail-buyer": 5n,
          },
        },
        createSeededRandom(3n),
      ),
    ).toEqual({ kind: "sell", inputAtomic: 10_000n });
    expect(
      sniper.decide(
        {
          ...unentered,
          tickIndex: 2n,
          portfolio: {
            ...unentered.portfolio,
            baseBalanceAtomic: 10_000n,
            successfulBuyCount: 1n,
            firstBuyTickIndex: 0n,
          },
        },
        createSeededRandom(3n),
      ),
    ).toEqual({ kind: "wait" });
    expect(
      sniper.decide(
        {
          ...unentered,
          tickIndex: 3n,
          portfolio: {
            ...unentered.portfolio,
            baseBalanceAtomic: 5_000n,
            successfulBuyCount: 1n,
            successfulSellCount: 1n,
            firstBuyTickIndex: 0n,
          },
          cumulativeBaseBoughtAtomicByArchetype: {
            ...unentered.cumulativeBaseBoughtAtomicByArchetype,
            "retail-buyer": 5n,
          },
        },
        createSeededRandom(3n),
      ),
    ).toEqual({ kind: "wait" });
  });

  it("reacts to price momentum, target gains, and drawdown thresholds", () => {
    const momentum = createMvpAgent({
      ...funding,
      archetype: "momentum-trader",
      priceIncreaseThresholdBps: 500n,
      buyQuoteAtomic: 100n,
      maximumPurchases: 2n,
    });
    expect(momentum.decide(makeObservation(), createSeededRandom(4n))).toEqual({ kind: "wait" });
    expect(
      momentum.decide(
        makeObservation({ tickIndex: 1n, spotPrice: new Decimal("2.1") }),
        createSeededRandom(4n),
      ),
    ).toEqual({ kind: "buy", inputAtomic: 100n });

    const profitTaker = createMvpAgent({
      ...funding,
      archetype: "profit-taker",
      entryTickIndex: 0n,
      buyQuoteAtomic: 100n,
      targetGainBps: 1_000n,
      sellShareBps: 2_500n,
    });
    const unentered = {
      ...makeObservation(),
      portfolio: {
        quoteBalanceAtomic: 1_000_000n,
        baseBalanceAtomic: 0n,
        baseCostBasisQuoteAtomic: 0n,
        successfulBuyCount: 0n,
        successfulSellCount: 0n,
        peakSpotPrice: new Decimal("2"),
      },
    };
    expect(profitTaker.decide(unentered, createSeededRandom(5n))).toEqual({
      kind: "buy",
      inputAtomic: 100n,
    });
    expect(
      profitTaker.decide(
        makeObservation({ spotPrice: new Decimal("1.1") }),
        createSeededRandom(5n),
      ),
    ).toEqual({ kind: "sell", inputAtomic: 2_500n });

    const panicSeller = createMvpAgent({
      ...funding,
      archetype: "panic-seller",
      entryTickIndex: 0n,
      buyQuoteAtomic: 100n,
      drawdownThresholdBps: 1_000n,
      sellShareBps: 5_000n,
    });
    expect(panicSeller.decide(unentered, createSeededRandom(6n))).toEqual({
      kind: "buy",
      inputAtomic: 100n,
    });
    expect(
      panicSeller.decide(
        makeObservation({ spotPrice: new Decimal("1.8") }),
        createSeededRandom(6n),
      ),
    ).toEqual({ kind: "sell", inputAtomic: 5_000n });
  });

  it("uses seeded choices for the random trader and rejects incomplete or invalid assumptions", () => {
    const configuration = {
      ...funding,
      archetype: "random-trader" as const,
      buyProbabilityBps: 10_000n,
      sellProbabilityBps: 0n,
      minimumBuyQuoteAtomic: 30n,
      maximumBuyQuoteAtomic: 90n,
      sellShareBps: 5_000n,
    };
    const first = createMvpAgent(configuration);
    const replay = createMvpAgent(configuration);
    expect(first.decide(makeObservation(), createSeededRandom(77n))).toEqual(
      replay.decide(makeObservation(), createSeededRandom(77n)),
    );

    expect(() =>
      createMvpAgent({
        ...configuration,
        buyProbabilityBps: 7_000n,
        sellProbabilityBps: 4_000n,
      }),
    ).toThrow("cannot sum above 10000 bps");
    expect(() =>
      createMvpAgent({
        ...funding,
        archetype: "whale",
        entryTickIndex: 0n,
        buyQuoteAtomic: 2_000_000n,
      }),
    ).toThrow("exceeds the agent's initial quote balance");
  });
});
