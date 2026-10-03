import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import { analyzeExitLiquiditySensitivity } from "./exit-liquidity-audit.js";
import type { AgentCounts } from "./simulation.js";
import { runPumpAndDumpAttack } from "./attacks/pump-and-dump.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makePumpAndDumpRun() {
  const result = runPumpAndDumpAttack({
    id: "exit-liquidity-pump-run",
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
  });
  if (result.status === "failed" || result.scenario !== "pump-and-dump") {
    throw new Error("Expected a summarized pump-and-dump attack");
  }
  return result;
}

describe("exit-liquidity sensitivity audit", () => {
  it("reports modeled sell drawdown with exact recovery-demand and late-buyer evidence", () => {
    const run = makePumpAndDumpRun();
    const result = analyzeExitLiquiditySensitivity({
      auditId: "exit-liquidity-audit",
      candidateId: "demo-candidate",
      pumpAndDumpRuns: [run],
    });

    expect(result.status).toBe("completed");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.valueBps).toBe(run.metrics.peakToTroughDrawdownBps.p95);
    expect(result.findings[0]?.severityMetric).toBe("maximum-drawdown-bps");
    expect(result.findings[0]?.evidence[0]?.reference).toBe(run.id);
    expect(result.findings[0]?.evidence[1]?.value).toEqual({
      kind: "amount",
      value: run.metrics.recoveryQuoteRequired.p95,
    });
    expect(result.findings[0]?.evidence[2]?.value).toEqual({
      kind: "basis-points",
      value: run.metrics.lateBuyerLossBps.p95,
    });
    expect(result.findings[0]?.summary).toContain("independently summarized");
    expect(result.findings[0]?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("keeps partial attack results partial and reports unavailable without scenarios", () => {
    const run = makePumpAndDumpRun();
    const partialRun = { ...run, status: "partial" as const };
    const partial = analyzeExitLiquiditySensitivity({
      auditId: "partial-exit-audit",
      candidateId: "demo-candidate",
      pumpAndDumpRuns: [partialRun],
    });
    const unavailable = analyzeExitLiquiditySensitivity({
      auditId: "empty-exit-audit",
      candidateId: "demo-candidate",
    });

    expect(partial.status).toBe("partial");
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.findings).toEqual([]);
  });
});
