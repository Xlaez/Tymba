import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../../examples/demo-market.js";
import type { AgentCounts } from "../simulation.js";
import type { PumpAndDumpAttackInput } from "./pump-and-dump.js";
import { runPumpAndDumpAttack } from "./pump-and-dump.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeInput(overrides: Partial<PumpAndDumpAttackInput> = {}): PumpAndDumpAttackInput {
  return {
    id: "pump-and-dump-fixture",
    randomSeed: 117n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    supportingAgentDistribution: {
      counts: { ...zeroCounts, "momentum-trader": 1n },
      templates: {
        "momentum-trader": {
          id: "momentum",
          archetype: "momentum-trader",
          initialQuoteBalanceAtomic: 20_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          priceIncreaseThresholdBps: 1n,
          buyQuoteAtomic: 1_000_000_000n,
          maximumPurchases: 5n,
        },
      },
    },
    attacker: {
      id: "attacker",
      initialQuoteBalanceAtomic: 20_000_000_000n,
      buyQuoteAtomic: 10_000_000_000n,
      entryTickIndex: 0n,
      holdTicks: 1n,
      minimumMomentumBaseAtomic: 1n,
      exitShareBps: 10_000n,
    },
    ticks: { tickCount: 5n, slotsPerTick: 1n, secondsPerTick: 1n },
    ...overrides,
  };
}

describe("pump-and-dump attack", () => {
  it("waits for momentum demand, sells after its buys, and reproduces risk metrics", () => {
    const input = makeInput();
    const first = runPumpAndDumpAttack(input);
    const replay = runPumpAndDumpAttack(input);

    expect(first.status).toBe("completed");
    if (first.status !== "completed" || first.scenario !== "pump-and-dump") {
      throw new Error("Expected completed pump-and-dump metrics");
    }
    if (replay.status !== "completed" || replay.scenario !== "pump-and-dump") {
      throw new Error("Expected completed pump-and-dump replay");
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
    expect(first.metrics.attackerPnlQuote.median.amount.raw).toBeTypeOf("bigint");
    expect(first.metrics.peakToTroughDrawdownBps.median).toBeGreaterThan(0n);
    expect(first.metrics.lateBuyerLossBps.median).toBeGreaterThan(0n);
    expect(first.metrics.recoveryQuoteRequired.p95.amount.raw).toBeGreaterThan(0n);
    expect(first.metrics.feesPaid.p95.quote.raw).toBeGreaterThan(0n);
  });

  it("retains a partial iteration when ticks end before the demand-gated exit", () => {
    const result = runPumpAndDumpAttack(
      makeInput({ ticks: { tickCount: 2n, slotsPerTick: 1n, secondsPerTick: 1n } }),
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed" || result.scenario !== "pump-and-dump") {
      throw new Error("Expected an incomplete pump-and-dump result");
    }
    expect(result.partialIterations).toBe(3n);
    expect(result.iterationOutcomes.every(({ status }) => status === "partial")).toBe(true);
  });

  it("requires momentum traders and an attacker buy that is funded", () => {
    expect(() =>
      runPumpAndDumpAttack(
        makeInput({ supportingAgentDistribution: { counts: zeroCounts, templates: {} } }),
      ),
    ).toThrow("momentum traders");
    expect(() =>
      runPumpAndDumpAttack(
        makeInput({ attacker: { ...makeInput().attacker, initialQuoteBalanceAtomic: 1n } }),
      ),
    ).toThrow("exceeds the attacker's quote balance");
  });
});
