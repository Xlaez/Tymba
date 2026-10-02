import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { AgentCounts } from "./simulation.js";
import {
  createMvpAgentPopulation,
  createStochasticSimulationInput,
  MAX_MVP_AGENT_POPULATION,
} from "./simulation-scenario.js";
import type { AgentDistributionConfiguration } from "./simulation-scenario.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

const retailTemplate = {
  id: "retail",
  archetype: "retail-buyer" as const,
  initialQuoteBalanceAtomic: 1_000n,
  initialBaseBalanceAtomic: 0n,
  initialBaseCostBasisQuoteAtomic: 0n,
  minimumBuyQuoteAtomic: 10n,
  maximumBuyQuoteAtomic: 50n,
  buyProbabilityBps: 2_500n,
  sellProbabilityBps: 1_000n,
  sellShareBps: 10_000n,
};

describe("stochastic scenario agent distributions", () => {
  it("expands explicit archetype counts into stable, unique agent identities", () => {
    const distribution: AgentDistributionConfiguration = {
      counts: { ...zeroCounts, "retail-buyer": 2n, whale: 1n },
      templates: {
        "retail-buyer": retailTemplate,
        whale: {
          id: "whale",
          archetype: "whale",
          initialQuoteBalanceAtomic: 10_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          entryTickIndex: 2n,
          buyQuoteAtomic: 5_000n,
        },
      },
    };
    const first = createMvpAgentPopulation(distribution);
    const replay = createMvpAgentPopulation(distribution);

    expect(first.agents.map(({ id }) => id)).toEqual(["retail-0", "retail-1", "whale-0"]);
    expect(first.agents.map(({ id }) => id)).toEqual(replay.agents.map(({ id }) => id));
    expect(first.agentCounts).toEqual(distribution.counts);
  });

  it("requires a matching behavior template for every configured nonzero count", () => {
    expect(() =>
      createMvpAgentPopulation({
        counts: { ...zeroCounts, sniper: 1n },
        templates: {},
      }),
    ).toThrow("template is required");

    expect(() =>
      createMvpAgentPopulation({
        counts: { ...zeroCounts, "retail-buyer": 1n },
        templates: {
          "retail-buyer": { ...retailTemplate, archetype: "whale" },
        } as unknown as AgentDistributionConfiguration["templates"],
      }),
    ).toThrow("template archetype does not match");
  });

  it("carries explicit seed, pool candidate, population, clock steps, and ordering into the run", () => {
    const ticks = {
      tickCount: 90n,
      slotsPerTick: 2n,
      secondsPerTick: 15n,
      executionOrder: "seeded-random" as const,
    };
    const input = createStochasticSimulationInput({
      id: "configured-scenario",
      randomSeed: 123n,
      initialState: createDemoPoolState(),
      agentDistribution: {
        counts: { ...zeroCounts, "retail-buyer": 2n },
        templates: { "retail-buyer": retailTemplate },
      },
      ticks,
    });

    expect(input.randomSeed).toBe(123n);
    expect(input.agents.map(({ id }) => id)).toEqual(["retail-0", "retail-1"]);
    expect(input.ticks).toEqual(ticks);
    expect(input.initialState.curve).toEqual(createDemoPoolState().curve);
  });

  it("rejects negative, non-bigint, unknown, and over-limit distributions", () => {
    expect(() =>
      createMvpAgentPopulation({
        counts: { ...zeroCounts, whale: -1n },
        templates: {},
      }),
    ).toThrow("non-negative bigint");

    expect(() =>
      createMvpAgentPopulation({
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
      }),
    ).toThrow("MVP limit");

    expect(() =>
      createMvpAgentPopulation({
        counts: { ...zeroCounts, "wrong-agent": 1n } as unknown as AgentCounts,
        templates: {},
      }),
    ).toThrow("Unsupported agent-distribution archetype");
  });
});
