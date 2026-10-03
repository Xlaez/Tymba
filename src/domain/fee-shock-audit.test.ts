import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import type { PoolState } from "./pool-state.js";
import { analyzeFeeShock } from "./fee-shock-audit.js";
import type { FeeScheduleTimingAttackInput } from "./attacks/fee-schedule-timing.js";
import { runFeeScheduleTimingAttack } from "./attacks/fee-schedule-timing.js";

function makeRun(kind: "linear" | "exponential") {
  const initialState: PoolState = {
    ...createDemoPoolState(),
    fees: {
      ...createDemoPoolState().fees,
      base: {
        kind,
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
  const input: FeeScheduleTimingAttackInput = {
    id: `fee-shock-${kind}`,
    initialState,
    buyQuoteAtomic: 1_000_000_000n,
  };
  const result = runFeeScheduleTimingAttack(input);
  if (result.status === "failed" || result.scenario !== "fee-schedule-timing") {
    throw new Error("Expected a summarized fee-schedule timing run");
  }
  return { result, initialState };
}

describe("fee-shock audit", () => {
  it("uses exact scheduled base-fee numerators and actual round-trip fee evidence", () => {
    const run = makeRun("linear");
    const audit = analyzeFeeShock({
      auditId: "linear-fee-shock-audit",
      candidateId: "demo-candidate",
      runs: [run],
    });

    expect(audit.status).toBe("completed");
    expect(audit.observations).toHaveLength(1);
    expect(audit.observations[0]?.valueBps).toBe(300n);
    expect(audit.findings[0]?.severityMetric).toBe("fee-shock-bps");
    expect(audit.findings[0]?.severity).toBe("MODERATE");
    expect(audit.findings[0]?.severityPolicyVersion).toBe("demo-v1");
    expect(audit.findings[0]?.evidence[0]?.value).toEqual({
      kind: "basis-points",
      value: 300n,
    });
    expect(
      audit.findings[0]?.evidence.some(
        ({ metric, value }) =>
          metric.includes("round-trip base fees paid") && value.kind === "amount",
      ),
    ).toBe(true);
    expect(
      audit.findings[0]?.evidence.some(({ metric }) =>
        metric.includes("exact absolute scheduled base-fee rate change"),
      ),
    ).toBe(true);
    expect(audit.findings[0]?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("measures exponential schedule steps through the same clock-aware simulator boundary", () => {
    const run = makeRun("exponential");
    const audit = analyzeFeeShock({
      auditId: "exponential-fee-shock-audit",
      candidateId: "demo-candidate",
      runs: [run],
    });

    expect(audit.status).toBe("completed");
    expect(audit.observations[0]?.valueBps).toBeGreaterThan(0n);
    expect(
      audit.findings[0]?.evidence.some(({ metric }) =>
        metric.includes("scheduled base-fee numerator before candidate"),
      ),
    ).toBe(true);
  });

  it("reports unavailable when no scheduled fee-timing runs are supplied", () => {
    const audit = analyzeFeeShock({
      auditId: "unavailable-fee-shock-audit",
      candidateId: "demo-candidate",
      runs: [],
    });

    expect(audit.status).toBe("unavailable");
    expect(audit.findings).toEqual([]);
  });
});
