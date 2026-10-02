import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { SimulationAgent } from "./stochastic-simulation.js";
import { runStochasticSimulationTrace } from "./stochastic-simulation.js";

function makeAgent(
  id: string,
  inputAtomic: bigint,
  observeQuote: (raw: bigint) => void,
): SimulationAgent {
  return {
    id,
    archetype: "retail-buyer",
    initialQuoteBalanceAtomic: 10_000_000n,
    initialBaseBalanceAtomic: 0n,
    initialBaseCostBasisQuoteAtomic: 0n,
    decide: ({ state }) => {
      observeQuote(state.ledger.pool.quote.raw);
      return { kind: "buy", inputAtomic };
    },
  };
}

describe("stochastic simulation tick runner", () => {
  it("records shared observations before actions and executes trades in agent order", () => {
    const observedQuotes: bigint[] = [];
    const result = runStochasticSimulationTrace({
      id: "tick-order",
      randomSeed: 19n,
      initialState: createDemoPoolState(),
      agents: [
        makeAgent("first", 1_000_000n, (raw) => observedQuotes.push(raw)),
        makeAgent("second", 2_000_000n, (raw) => observedQuotes.push(raw)),
      ],
      ticks: {
        tickCount: 1n,
        slotsPerTick: 3n,
        secondsPerTick: 5n,
        executionOrder: "configured",
      },
    });

    expect(observedQuotes).toEqual([0n, 0n]);
    expect(result.status).toBe("completed");
    expect(result.randomSeed).toBe(19n);
    expect(result.randomAlgorithm).toBe("splitmix64-v1");
    expect(result.completedTicks).toBe(1n);
    expect(result.finalState.clock).toEqual({ slot: 3n, timestampSeconds: 5n });
    expect(result.agentCounts["retail-buyer"]).toBe(2n);
    expect(result.events.map(({ kind }) => kind)).toEqual([
      "tick-observed",
      "action-decided",
      "action-decided",
      "trade-executed",
      "trade-executed",
      "tick-completed",
    ]);

    const trades = result.events.filter((event) => event.kind === "trade-executed");
    expect(trades.map(({ agentId }) => agentId)).toEqual(["first", "second"]);
    if (trades[0]?.kind !== "trade-executed" || trades[1]?.kind !== "trade-executed") {
      throw new Error("Expected two trade execution events");
    }
    expect(
      trades[1].result.metrics.spotPriceBefore.eq(trades[0].result.metrics.spotPriceAfter),
    ).toBe(true);
    expect(result.portfolios.map(({ quoteBalanceAtomic }) => quoteBalanceAtomic)).toEqual([
      9_000_000n,
      8_000_000n,
    ]);
    expect(result.portfolios.map(({ baseBalanceAtomic }) => baseBalanceAtomic)).toEqual([
      trades[0].result.output.amount.raw,
      trades[1].result.output.amount.raw,
    ]);
    expect(
      result.portfolios.map(({ baseCostBasisQuoteAtomic }) => baseCostBasisQuoteAtomic),
    ).toEqual([
      trades[0].result.consumedInput.amount.raw,
      trades[1].result.consumedInput.amount.raw,
    ]);
  });

  it("retains rejected actions and marks agent implementation failures as partial", () => {
    const result = runStochasticSimulationTrace({
      id: "agent-errors",
      randomSeed: 2n,
      initialState: createDemoPoolState(),
      agents: [
        {
          id: "broken",
          archetype: "random-trader",
          initialQuoteBalanceAtomic: 0n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          decide: () => {
            throw new Error("fixture agent failure");
          },
        },
        {
          id: "invalid-sell",
          archetype: "panic-seller",
          initialQuoteBalanceAtomic: 0n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          decide: () => ({ kind: "sell", inputAtomic: 1n }),
        },
      ],
      ticks: {
        tickCount: 1n,
        slotsPerTick: 1n,
        secondsPerTick: 1n,
        executionOrder: "configured",
      },
    });

    expect(result.status).toBe("partial");
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: "agent-failed", message: "fixture agent failure" }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: "action-rejected", agentId: "invalid-sell" }),
    );
  });

  it("replays the explicitly seeded randomized execution order", () => {
    const agents = Array.from(
      { length: 8 },
      (_, index): SimulationAgent => ({
        id: `agent-${index}`,
        archetype: "random-trader",
        initialQuoteBalanceAtomic: 0n,
        initialBaseBalanceAtomic: 0n,
        initialBaseCostBasisQuoteAtomic: 0n,
        decide: () => ({ kind: "wait" }),
      }),
    );
    const input = {
      id: "random-order",
      randomSeed: 88n,
      initialState: createDemoPoolState(),
      agents,
      ticks: {
        tickCount: 1n,
        slotsPerTick: 1n,
        secondsPerTick: 1n,
        executionOrder: "seeded-random" as const,
      },
    };
    const first = runStochasticSimulationTrace(input);
    const replay = runStochasticSimulationTrace(input);
    const firstOrder = first.events
      .filter((event) => event.kind === "action-decided")
      .map(({ agentId }) => agentId);
    const replayOrder = replay.events
      .filter((event) => event.kind === "action-decided")
      .map(({ agentId }) => agentId);

    expect(first.executionOrder).toBe("seeded-random");
    expect(firstOrder).toEqual(replayOrder);
    expect([...firstOrder].sort()).toEqual(agents.map(({ id }) => id).sort());
  });

  it("requires explicit positive tick units and unique agent identities", () => {
    const baseInput = {
      id: "invalid-tick-config",
      randomSeed: 1n,
      initialState: createDemoPoolState(),
      agents: [] as readonly SimulationAgent[],
      ticks: {
        tickCount: 0n,
        slotsPerTick: 1n,
        secondsPerTick: 1n,
        executionOrder: "configured" as const,
      },
    };
    expect(() => runStochasticSimulationTrace(baseInput)).toThrow("must be positive bigints");

    const repeatedAgent = makeAgent("same", 1n, () => undefined);
    expect(() =>
      runStochasticSimulationTrace({
        ...baseInput,
        ticks: {
          tickCount: 1n,
          slotsPerTick: 1n,
          secondsPerTick: 1n,
          executionOrder: "configured",
        },
        agents: [repeatedAgent, repeatedAgent],
      }),
    ).toThrow("Duplicate simulation agent id");
  });
});
