import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import { currencyAmount } from "./currency-amount.js";
import { analyzeSniperExposure } from "./sniper-exposure-audit.js";
import type { AgentCounts } from "./simulation.js";
import { runOpeningSniperAttack } from "./attacks/opening-sniper.js";
import type { OpeningSniperAuditRun } from "./sniper-exposure-audit.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeRun(): OpeningSniperAuditRun {
  const result = runOpeningSniperAttack({
    id: "audit-opening-sniper",
    randomSeed: 73n,
    requestedIterations: 2n,
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
  });
  if (result.status === "failed" || result.scenario !== "opening-sniper") {
    throw new Error("Expected a summarized opening-sniper attack");
  }
  return {
    result,
    capitalAtRiskQuote: {
      asset: "quote",
      amount: currencyAmount(100_000_000n, 6),
    },
  };
}

describe("sniper-exposure audit", () => {
  it("normalizes p95 attacker PnL by explicit quote capital and retains both inputs", () => {
    const inputRun = makeRun();
    const resultWithProfit = {
      ...inputRun.result,
      metrics: {
        ...inputRun.result.metrics,
        attackerPnlQuote: {
          p05: { asset: "quote" as const, amount: currencyAmount(10_000_000n, 6) },
          median: { asset: "quote" as const, amount: currencyAmount(20_000_000n, 6) },
          p95: { asset: "quote" as const, amount: currencyAmount(30_000_000n, 6) },
        },
      },
    };
    const audit = analyzeSniperExposure({
      auditId: "sniper-audit",
      candidateId: "demo-candidate",
      openingSniperRuns: [{ ...inputRun, result: resultWithProfit }],
    });

    expect(audit.status).toBe("completed");
    expect(audit.observations[0]?.valueBps).toBe(3_000n);
    expect(audit.findings[0]?.severity).toBe("HIGH");
    expect(audit.findings[0]?.severityPolicyVersion).toBe("demo-v1");
    expect(audit.findings[0]?.evidence).toHaveLength(3);
    expect(audit.findings[0]?.evidence[1]?.value).toEqual({
      kind: "amount",
      value: resultWithProfit.metrics.attackerPnlQuote.p95,
    });
    expect(audit.findings[0]?.evidence[2]?.value).toEqual({
      kind: "amount",
      value: inputRun.capitalAtRiskQuote,
    });
    expect(audit.findings[0]?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("keeps negative PnL evidence while assigning zero positive-return risk", () => {
    const inputRun = makeRun();
    const audit = analyzeSniperExposure({
      auditId: "unprofitable-sniper-audit",
      candidateId: "demo-candidate",
      openingSniperRuns: [inputRun],
    });
    const rawPnl = inputRun.result.metrics.attackerPnlQuote.p95.amount.raw;

    expect(rawPnl).toBeLessThan(0n);
    expect(audit.observations[0]?.valueBps).toBe(0n);
    expect(audit.findings[0]?.evidence[1]?.value).toEqual({
      kind: "amount",
      value: inputRun.result.metrics.attackerPnlQuote.p95,
    });
  });

  it("rejects a missing or mismatched capital-at-risk basis", () => {
    const inputRun = makeRun();
    expect(() =>
      analyzeSniperExposure({
        auditId: "missing-capital-audit",
        candidateId: "demo-candidate",
        openingSniperRuns: [{ result: inputRun.result } as never],
      }),
    ).toThrow("capital-at-risk");
    expect(() =>
      analyzeSniperExposure({
        auditId: "wrong-decimal-audit",
        candidateId: "demo-candidate",
        openingSniperRuns: [
          {
            ...inputRun,
            capitalAtRiskQuote: {
              asset: "quote",
              amount: currencyAmount(100n, 9),
            },
          },
        ],
      }),
    ).toThrow("matching decimals");
  });
});
