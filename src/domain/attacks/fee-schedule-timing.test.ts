import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../../examples/demo-market.js";
import type { PoolState } from "../pool-state.js";
import type { FeeScheduleTimingAttackInput } from "./fee-schedule-timing.js";
import { runFeeScheduleTimingAttack } from "./fee-schedule-timing.js";

function makeInput(
  overrides: Partial<FeeScheduleTimingAttackInput> = {},
): FeeScheduleTimingAttackInput {
  const initialState: PoolState = {
    ...createDemoPoolState(),
    fees: {
      ...createDemoPoolState().fees,
      base: {
        kind: "linear",
        startingFeeBps: 1_000n,
        endingFeeBps: 100n,
        periodCount: 3n,
        periodFrequency: 10n,
        clock: "timestamp",
      },
    },
    clock: { slot: 0n, timestampSeconds: 100n },
    activationPoint: 100n,
    activationType: "timestamp",
  };

  return {
    id: "fee-schedule-timing-fixture",
    initialState,
    buyQuoteAtomic: 1_000_000_000n,
    ...overrides,
  };
}

describe("fee-schedule timing attack", () => {
  it("sweeps every fee-decay boundary and finds the best round-trip entry clock", () => {
    const result = runFeeScheduleTimingAttack(makeInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed" || result.scenario !== "fee-schedule-timing") {
      throw new Error("Expected a completed fee-schedule timing result");
    }
    expect("randomSeed" in result).toBe(false);
    expect(result.candidateCount).toBe(4n);
    expect(result.completedCandidates).toBe(4n);
    expect(result.metrics.bestEntryClock.timestampSeconds).toBe(130n);
    expect(result.metrics.feesSaved.quote.raw).toBeGreaterThan(0n);
    expect(result.metrics.pnlImprovementQuote.amount.raw).toBeGreaterThan(0n);
    expect(result.candidateOutcomes.every(({ status }) => status === "completed")).toBe(true);
    expect({
      candidateOutcomes: result.candidateOutcomes,
      metrics: result.metrics,
    }).toMatchSnapshot();
  });

  it("requires a scheduled base fee and a positive bounded trade size", () => {
    expect(() =>
      runFeeScheduleTimingAttack({
        ...makeInput(),
        initialState: createDemoPoolState(),
      }),
    ).toThrow("requires a linear or exponential");
    expect(() => runFeeScheduleTimingAttack(makeInput({ buyQuoteAtomic: 0n }))).toThrow(
      "positive unsigned 64-bit",
    );
  });
});
