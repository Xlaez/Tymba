import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import { analyzeEarlyAdvantage } from "./early-advantage-audit.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import { quoteBuy } from "./simulator.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
import type { AgentCounts, StochasticSimulationResult } from "./simulation.js";

const zeroCounts: AgentCounts = {
  "retail-buyer": 0n,
  whale: 0n,
  sniper: 0n,
  "momentum-trader": 0n,
  "profit-taker": 0n,
  "panic-seller": 0n,
  "random-trader": 0n,
};

function makeStochasticRun(buyers: bigint): StochasticSimulationResult {
  const result = runMonteCarloSimulation({
    id: buyers === 0n ? "early-advantage-no-buyers" : "early-advantage-two-buyers",
    randomSeed: 191n,
    requestedIterations: 3n,
    initialState: createDemoPoolState(),
    agentDistribution: {
      counts: { ...zeroCounts, "retail-buyer": buyers },
      templates:
        buyers === 0n
          ? {}
          : {
              "retail-buyer": {
                id: "retail",
                archetype: "retail-buyer",
                initialQuoteBalanceAtomic: 10_000_000_000n,
                initialBaseBalanceAtomic: 0n,
                initialBaseCostBasisQuoteAtomic: 0n,
                minimumBuyQuoteAtomic: 1_000_000_000n,
                maximumBuyQuoteAtomic: 1_000_000_000n,
                buyProbabilityBps: 10_000n,
                sellProbabilityBps: 0n,
                sellShareBps: 10_000n,
              },
            },
    },
    ticks: {
      tickCount: 1n,
      slotsPerTick: 1n,
      secondsPerTick: 1n,
      executionOrder: "configured",
    },
  });
  if (result.status === "failed") throw new Error("Expected a summarized stochastic run");
  return result;
}

describe("early-participant advantage audit", () => {
  it("compares the exact first quote tranche against the nearest-rank median buyer price", () => {
    const run = makeStochasticRun(2n);
    const distribution = run.summary.earlyParticipantAdvantage;
    expect(distribution).toBeDefined();
    expect(run.summary.earlyParticipantAdvantageSampleSize).toBe(3n);
    if (!distribution) throw new Error("Expected early-participant measurements");

    expect(distribution.p95.priceAdvantageBps).toBeGreaterThan(0n);
    expect(
      distribution.p95.firstTenPercentQuoteAveragePrice.lessThan(
        distribution.p95.medianBuyerAveragePrice,
      ),
    ).toBe(true);
    const exactFirstTranche = quoteBuy(200_000_000n, createDemoPoolState());
    const exactFirstTranchePrice = new ExactDecimal("200000000")
      .mul("1000000000")
      .div(new ExactDecimal(exactFirstTranche.output.amount.raw.toString()).mul("1000000"));
    expect(distribution.p95.firstTenPercentQuoteAveragePrice.toString()).toBe(
      exactFirstTranchePrice.toString(),
    );
    const expectedAdvantageBps = BigInt(
      new ExactDecimal(
        distribution.p95.medianBuyerAveragePrice
          .minus(distribution.p95.firstTenPercentQuoteAveragePrice)
          .toString(),
      )
        .mul("10000")
        .div(distribution.p95.medianBuyerAveragePrice.toString())
        .floor()
        .toFixed(0),
    );
    expect(distribution.p95.priceAdvantageBps).toBe(expectedAdvantageBps);
    expect(distribution.p95.quoteVolume.asset).toBe("quote");
    expect(distribution.p95.quoteVolume.amount.raw).toBeGreaterThan(0n);

    const result = analyzeEarlyAdvantage({
      auditId: "early-advantage-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [run],
    });
    const finding = result.findings[0];

    expect(result.status).toBe("completed");
    expect(result.observations[0]?.valueBps).toBe(distribution.p95.priceAdvantageBps);
    expect(finding?.severityMetric).toBe("early-buyer-price-advantage-bps");
    expect(finding?.severityPolicyVersion).toBe("demo-v1");
    expect(finding?.evidence).toHaveLength(4);
    expect(finding?.evidence[1]?.value).toEqual({
      kind: "decimal",
      value: distribution.p95.firstTenPercentQuoteAveragePrice,
    });
    expect(finding?.evidence[2]?.value).toEqual({
      kind: "decimal",
      value: distribution.p95.medianBuyerAveragePrice,
    });
    expect(finding?.evidence[3]?.value).toEqual({
      kind: "amount",
      value: distribution.p95.quoteVolume,
    });
    expect(finding?.suggestedRemediations[0]).toContain("trade-off:");
  });

  it("reports unavailable when completed runs lack enough buyer data", () => {
    const result = analyzeEarlyAdvantage({
      auditId: "no-buyer-audit",
      candidateId: "demo-candidate",
      stochasticRuns: [makeStochasticRun(0n)],
    });

    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
