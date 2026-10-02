import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { generateInitialPriceBreakpoints } from "./solver-candidate-generation.js";
import { validateCandidateCurve } from "./solver-candidate-validation.js";
import { validateMarketIntent } from "./market-intent.js";
import { evaluateSolverObjective } from "./solver-objective.js";
import { explainCandidateLiquidity } from "./solver-explanations.js";

const intent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startFdv: "200000", migrationFdv: "2000000" },
  targets: {},
  solver: { maxSegments: 3 },
};

function validMarket() {
  const result = validateMarketIntent(intent);
  if (result.status === "invalid") throw new Error("Test market intent must be valid");
  return result.normalized;
}

function validCurve() {
  const market = validMarket();
  const result = validateCandidateCurve({
    market,
    priceBreakpoints: generateInitialPriceBreakpoints(market),
    segmentLiquidities: [10n ** 26n, 2n * 10n ** 26n, 3n * 10n ** 26n],
    migrationQuoteThresholdAtomic: 1n,
  });
  if (result.status === "invalid") throw new Error("Test curve must be valid");
  return { market, curve: result.curve };
}

function objectiveWithAllocationDrivers() {
  return evaluateSolverObjective(
    {
      quoteError: new Decimal("0.5"),
      distributionError: new Decimal("0.5"),
      migrationPriceError: new Decimal(0),
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal(0),
      complexity: new Decimal(0),
    },
    {
      quoteTargetAtomic: 100n,
      quoteAchievedAtomic: 100n,
      distributionTargetBps: 2_500n,
      distributionAchievedBps: 2_500n,
    },
  );
}

describe("explainCandidateLiquidity", () => {
  it("explains each segment using exact quote/base contribution metrics and active objective drivers", () => {
    const { market, curve } = validCurve();
    const explanations = explainCandidateLiquidity({
      market,
      curve,
      objective: objectiveWithAllocationDrivers(),
    });

    expect(explanations).toHaveLength(3);
    expect(explanations[0]?.message).toContain("Segment 1 spans");
    expect(explanations[0]?.message).toContain("USDC/MKT");
    expect(explanations[0]?.message).toContain("weighted capital and distribution fit");
    const evidence = explanations[0]?.evidence;
    expect(evidence?.kind).toBe("segment_liquidity");
    expect(evidence?.liquidity).toBe(curve.segments[0]?.liquidity);
    expect(evidence?.weightedObjectiveTerms.map(({ term }) => term)).toEqual([
      "quoteError",
      "distributionError",
    ]);
    expect(evidence?.weightedObjectiveTerms.map(({ weight }) => weight.toFixed())).toEqual([
      "0.5",
      "0.5",
    ]);
    expect(evidence?.quoteAbsorbed.decimals).toBe(market.quoteDecimals);
    expect(evidence?.baseDistributed.decimals).toBe(market.baseDecimals);
    expect(evidence?.quoteContributionBps).toBeGreaterThan(0n);
  });

  it("does not claim a target drove the allocation when neither target term is weighted", () => {
    const { market, curve } = validCurve();
    const objective = evaluateSolverObjective(
      {
        quoteError: new Decimal(0),
        distributionError: new Decimal(0),
        migrationPriceError: new Decimal(0),
        earlyPriceImpact: new Decimal(0),
        attackProfitability: new Decimal(0),
        complexity: new Decimal(1),
      },
      { segmentCount: curve.segments.length, maxSegments: market.maxSegments },
    );
    const explanations = explainCandidateLiquidity({ market, curve, objective });

    expect(explanations[0]?.message).toContain("no active capital or distribution fit weight");
    expect(explanations[0]?.evidence?.weightedObjectiveTerms).toEqual([]);
  });

  it("rejects curves with inconsistent asset scales, endpoints, limits, capacity, or supply", () => {
    const { market, curve } = validCurve();
    const objective = objectiveWithAllocationDrivers();

    expect(() =>
      explainCandidateLiquidity({
        market: { ...market, baseDecimals: 8 },
        curve,
        objective,
      }),
    ).toThrow("Curve asset decimals must match");
    expect(() =>
      explainCandidateLiquidity({
        market: { ...market, migrationPrice: new Decimal("0.003") },
        curve,
        objective,
      }),
    ).toThrow("Curve endpoints must match");
    expect(() =>
      explainCandidateLiquidity({
        market: { ...market, maxSegments: 2 },
        curve,
        objective,
      }),
    ).toThrow("Curve segment count must not exceed");
    expect(() =>
      explainCandidateLiquidity({
        market: { ...market, totalBaseAtomic: 1n },
        curve,
        objective,
      }),
    ).toThrow("Curve base distribution must not exceed");
  });
});
