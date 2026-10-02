import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../../examples/demo-market.js";
import type { AgentCounts } from "../simulation.js";
import type { WhaleEntryAttackInput } from "./whale-entry.js";
import { runWhaleEntryAttack } from "./whale-entry.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeInput(overrides: Partial<WhaleEntryAttackInput> = {}): WhaleEntryAttackInput {
  return {
    id: "whale-entry-fixture",
    randomSeed: 81n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    supportingAgentDistribution: { counts: zeroCounts, templates: {} },
    attacker: {
      id: "whale",
      initialQuoteBalanceAtomic: 20_000_000_000n,
      migrationQuoteShareBps: 1_000n,
      entryTickIndex: 0n,
    },
    ticks: { tickCount: 3n, slotsPerTick: 1n, secondsPerTick: 1n },
    ...overrides,
  };
}

describe("whale-entry attack", () => {
  it("buys the configured migration-quote share and reports reproducible impact", () => {
    const input = makeInput();
    const first = runWhaleEntryAttack(input);
    const replay = runWhaleEntryAttack(input);

    expect(first.status).toBe("completed");
    if (first.status !== "completed") throw new Error("Expected a completed whale-entry run");
    if (first.scenario !== "whale-entry") throw new Error("Expected whale-entry metrics");
    if (replay.status !== "completed" || replay.scenario !== "whale-entry") {
      throw new Error("Expected a completed whale-entry replay");
    }
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
    expect(first.metrics.priceDisplacementBps.median).toBeGreaterThan(0n);
    expect(first.metrics.baseAcquired.median.amount.raw).toBeGreaterThan(0n);
    expect(first.metrics.averageExecutionPrice.median.greaterThan(0)).toBe(true);
    expect(first.metrics.postBuyConcentrationBps.median).toBe(10_000n);
  });

  it("rejects an entry tick outside the configured run", () => {
    expect(() =>
      runWhaleEntryAttack(makeInput({ attacker: { ...makeInput().attacker, entryTickIndex: 3n } })),
    ).toThrow("within the configured tick range");
  });

  it("rejects unsupported distributions and underfunded whale entries", () => {
    expect(() =>
      runWhaleEntryAttack(
        makeInput({
          supportingAgentDistribution: {
            counts: { ...zeroCounts, whale: 1n },
            templates: {},
          },
        }),
      ),
    ).toThrow("no supporting whale agents");
    expect(() =>
      runWhaleEntryAttack(
        makeInput({ attacker: { ...makeInput().attacker, initialQuoteBalanceAtomic: 1n } }),
      ),
    ).toThrow("must fund the configured migration-quote share");
  });
});
