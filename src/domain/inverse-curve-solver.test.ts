import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { validateMarketIntent } from "./market-intent.js";
import { priceToSqrtPriceQ64x64 } from "./price.js";
import { sqrtPriceQ64x64ToPrice } from "./price.js";
import { quoteBuy } from "./curve-swap.js";
import { solveMarketCurve } from "./inverse-curve-solver.js";
import type { SolverObjectiveWeights } from "./solver-objective.js";

const demoIntent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startPrice: "0.0002", migrationPrice: "0.002" },
  targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
  solver: { maxSegments: 3 },
};

const objectiveWeights: SolverObjectiveWeights = {
  quoteError: new Decimal("0.3"),
  distributionError: new Decimal("0.3"),
  migrationPriceError: new Decimal("0.1"),
  earlyPriceImpact: new Decimal("0.1"),
  attackProfitability: new Decimal(0),
  complexity: new Decimal("0.2"),
};

const simulationConfiguration = {
  fees: {
    base: { kind: "fixed" as const, feeBps: 25n },
    collectFeeMode: "quote" as const,
    creatorTradingFeeShareBps: 2_500n,
  },
  migration: { destination: "damm-v2" as const },
  supplyMode: "fixed" as const,
  clock: { slot: 0n, timestampSeconds: 0n },
  activationPoint: 0n,
  activationType: "slot" as const,
};

const satisfiableFixtures = [
  {
    name: "start and migration price",
    intent: {
      assets: demoIntent.assets,
      supply: demoIntent.supply,
      pricing: { startPrice: "0.0002", migrationPrice: "0.002" },
      targets: {},
      solver: { maxSegments: 3 },
    },
    weights: {
      quoteError: new Decimal(0),
      distributionError: new Decimal(0),
      migrationPriceError: new Decimal("0.8"),
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal(0),
      complexity: new Decimal("0.2"),
    },
    quoteTargetAtomic: undefined,
    distributionTargetBps: undefined,
  },
  {
    name: "quote target",
    intent: {
      assets: demoIntent.assets,
      supply: demoIntent.supply,
      pricing: demoIntent.pricing,
      targets: { quoteToMigration: "150000" },
      solver: { maxSegments: 3 },
    },
    weights: {
      quoteError: new Decimal("0.8"),
      distributionError: new Decimal(0),
      migrationPriceError: new Decimal(0),
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal(0),
      complexity: new Decimal("0.2"),
    },
    quoteTargetAtomic: 150_000_000_000n,
    distributionTargetBps: undefined,
  },
  {
    name: "base distribution target",
    intent: {
      assets: demoIntent.assets,
      supply: demoIntent.supply,
      pricing: demoIntent.pricing,
      targets: { baseDistributionPct: "25" },
      solver: { maxSegments: 3 },
    },
    weights: {
      quoteError: new Decimal(0),
      distributionError: new Decimal("0.8"),
      migrationPriceError: new Decimal(0),
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal(0),
      complexity: new Decimal("0.2"),
    },
    quoteTargetAtomic: undefined,
    distributionTargetBps: 2_500n,
  },
] as const;

const unsatisfiableFixtures = [
  { maxSegments: 3, minimumQuote: "0.000003", minimumAtomic: 3 },
  { maxSegments: 2, minimumQuote: "0.000002", minimumAtomic: 2 },
] as const;

function normalizedMarket(intent: unknown = demoIntent) {
  const result = validateMarketIntent(intent);
  if (result.status === "invalid") throw new Error("Test market intent must be valid");
  return result.normalized;
}

describe("solveMarketCurve", () => {
  it.each(satisfiableFixtures)("solves the $name fixture", (fixture) => {
    const market = normalizedMarket(fixture.intent);
    const result = solveMarketCurve(market, {
      objectiveWeights: fixture.weights,
      simulation: simulationConfiguration,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    const candidate = result.candidates[0];
    expect(candidate?.curve.startSqrtPriceQ64x64).toBe(
      priceToSqrtPriceQ64x64(
        market.startPrice.toFixed(),
        market.baseDecimals,
        market.quoteDecimals,
      ),
    );
    expect(candidate?.curve.segments.at(-1)?.upperSqrtPriceQ64x64).toBe(
      priceToSqrtPriceQ64x64(
        market.migrationPrice.toFixed(),
        market.baseDecimals,
        market.quoteDecimals,
      ),
    );
    expect(candidate?.simulation.kind).toBe("deterministic");
    expect(candidate?.sdkCurveValidation).toMatchObject({
      sdkVersion: "1.5.13",
      curveEntryCount: 3,
    });
    expect(candidate?.simulation.metrics.quoteAccumulated.amount.raw).toBe(
      candidate?.metrics.quoteToMigration.raw,
    );
    expect(candidate?.simulation.metrics.baseDistributed.amount.raw).toBe(
      candidate?.metrics.baseDistributed.raw,
    );
    if (fixture.quoteTargetAtomic !== undefined) {
      expect(candidate?.metrics.quoteToMigration.raw).toBe(fixture.quoteTargetAtomic);
    }
    if (fixture.distributionTargetBps !== undefined) {
      expect(candidate?.metrics.baseDistributedBps).toBe(fixture.distributionTargetBps);
    }
  });

  it("finds a locally valid candidate for the demo start, migration, quote, and distribution targets", () => {
    const market = normalizedMarket();
    const result = solveMarketCurve(market, {
      objectiveWeights,
      simulation: simulationConfiguration,
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
      earlyPriceImpactEvaluator: ({ candidateId, curve, probeQuoteAtomic }) => {
        const quote = quoteBuy(curve, probeQuoteAtomic);
        const initial = sqrtPriceQ64x64ToPrice(
          curve.startSqrtPriceQ64x64,
          curve.baseDecimals,
          curve.quoteDecimals,
        );
        const after = sqrtPriceQ64x64ToPrice(
          quote.nextSqrtPriceQ64x64,
          curve.baseDecimals,
          curve.quoteDecimals,
        );
        const priceImpactBps = BigInt(
          after.minus(initial).abs().mul("10000").div(initial).floor().toFixed(0),
        );
        return { priceImpactBps, evidenceId: `test-sim-${candidateId}` };
      },
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(({ meetsRequestedTargets }) => meetsRequestedTargets)).toBe(true);
    expect(result.status).toBe("satisfied");
    const exactCandidate = result.candidates.find(
      ({ meetsRequestedTargets }) => meetsRequestedTargets,
    );
    expect(exactCandidate?.metrics.quoteToMigration.raw).toBe(150_000_000_000n);
    expect(exactCandidate?.metrics.baseDistributedBps).toBe(2_500n);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "verification_pending", verificationStatus: "unverified" }),
    );
    for (const candidate of result.candidates) {
      expect(candidate.curve.startSqrtPriceQ64x64).toBe(
        priceToSqrtPriceQ64x64("0.0002", market.baseDecimals, market.quoteDecimals),
      );
      expect(candidate.curve.segments.at(-1)?.upperSqrtPriceQ64x64).toBe(
        priceToSqrtPriceQ64x64("0.002", market.baseDecimals, market.quoteDecimals),
      );
      expect(candidate.curve.migrationQuoteThresholdAtomic).toBe(
        candidate.metrics.quoteToMigration.raw,
      );
      expect(candidate.metrics.quoteToMigration.raw).toBe(150_000_000_000n);
      expect(candidate.metrics.baseDistributedBps).toBeLessThanOrEqual(10_000n);
    }
  });

  it("uses the original intent's numeric early-impact limit in the solver penalty", () => {
    const market = normalizedMarket({
      ...demoIntent,
      preferences: { maxEarlyPriceImpactPct: "3" },
    });
    const result = solveMarketCurve(market, {
      objectiveWeights,
      simulation: simulationConfiguration,
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
      earlyPriceImpactEvaluator: ({ candidateId }) => ({
        priceImpactBps: 600n,
        evidenceId: `intent-limit-${candidateId}`,
      }),
    });
    const candidate = result.candidates[0];

    expect(candidate?.objective.measurements.maxEarlyPriceImpactBps).toBe(300n);
    expect(candidate?.objective.terms.earlyPriceImpact.normalizedPenalty?.toFixed()).toBe("0.03");
  });

  it("derives start and migration prices from FDV and supports a quote-only target", () => {
    const market = normalizedMarket({
      assets: demoIntent.assets,
      supply: demoIntent.supply,
      pricing: { startFdv: "200000", migrationFdv: "2000000" },
      targets: { quoteToMigration: "150000" },
      solver: { maxSegments: 3 },
    });
    const result = solveMarketCurve(market, {
      objectiveWeights: {
        quoteError: new Decimal("0.7"),
        distributionError: new Decimal(0),
        migrationPriceError: new Decimal("0.1"),
        earlyPriceImpact: new Decimal(0),
        attackProfitability: new Decimal(0),
        complexity: new Decimal("0.2"),
      },
      simulation: simulationConfiguration,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.metrics.quoteToMigration.raw).toBe(150_000_000_000n);
    expect(
      result.candidates[0]?.metrics.migrationPrice
        .minus(market.migrationPrice)
        .abs()
        .div(market.migrationPrice)
        .lt(new Decimal("1e-15")),
    ).toBe(true);
  });

  it("requires measurements and explicit weights for enabled objectives", () => {
    const market = normalizedMarket();
    const attackWeighted: SolverObjectiveWeights = {
      ...objectiveWeights,
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal("0.1"),
    };
    const missingAttack = solveMarketCurve(market, {
      objectiveWeights: attackWeighted,
      simulation: simulationConfiguration,
    });
    const missingWeights = solveMarketCurve(market, {} as never);
    const simulationFreeWeights: SolverObjectiveWeights = {
      ...objectiveWeights,
      migrationPriceError: new Decimal("0.2"),
      earlyPriceImpact: new Decimal(0),
    };
    const missingSimulation = solveMarketCurve(market, {
      objectiveWeights: simulationFreeWeights,
    } as never);

    expect(missingAttack.status).toBe("unsatisfied");
    expect(missingAttack.issues.map(({ code }) => code)).toContain("missing_attack_measurement");
    expect(missingWeights.status).toBe("unsatisfied");
    expect(missingWeights.issues.map(({ code }) => code)).toContain("missing_objective_weights");
    expect(missingSimulation.status).toBe("unsatisfied");
    expect(missingSimulation.issues.map(({ code }) => code)).toContain(
      "missing_simulation_configuration",
    );
  });

  it("records JSON-safe reproducible inputs, configuration, weights, and output metrics", () => {
    const market = normalizedMarket(satisfiableFixtures[1].intent);
    const options = {
      objectiveWeights: satisfiableFixtures[1].weights,
      simulation: simulationConfiguration,
    };
    const first = solveMarketCurve(market, options);
    const second = solveMarketCurve(market, options);
    const serializedRun = JSON.parse(JSON.stringify(first.run)) as {
      sdkVersion: string;
      randomSeed: string | null;
      seedPolicy: string;
      input: { totalBaseAtomic: string };
      configuration: { simulation: { fees: { base: { feeBps: string } } } };
      objectiveWeights: { quoteError: string };
      outputMetrics: readonly { metrics: { quoteToMigrationAtomic: string } }[];
    };

    expect(first.run).toEqual(second.run);
    expect(JSON.stringify(first.run)).toBe(JSON.stringify(second.run));
    expect(first.run.deterministic).toBe(true);
    expect(first.run.randomSeed).toBeNull();
    expect(first.run.seedPolicy).toBe("not-applicable-no-randomness");
    expect(serializedRun.sdkVersion).toBe("1.5.13");
    expect(serializedRun.input.totalBaseAtomic).toBe("1000000000000000000");
    expect(serializedRun.configuration.simulation.fees.base.feeBps).toBe("25");
    expect(serializedRun.objectiveWeights.quoteError).toBe("0.8");
    expect(serializedRun.outputMetrics[0]?.metrics.quoteToMigrationAtomic).toBe("150000000000");
  });

  it.each(
    unsatisfiableFixtures,
  )("explains an atomic quote target that cannot fund $maxSegments segments", ({
    maxSegments,
    minimumQuote,
    minimumAtomic,
  }) => {
    const market = normalizedMarket({
      assets: demoIntent.assets,
      supply: demoIntent.supply,
      pricing: demoIntent.pricing,
      targets: { quoteToMigration: "0.000001" },
      solver: { maxSegments },
    });
    const result = solveMarketCurve(market, {
      objectiveWeights: {
        quoteError: new Decimal("0.8"),
        distributionError: new Decimal(0),
        migrationPriceError: new Decimal(0),
        earlyPriceImpact: new Decimal(0),
        attackProfitability: new Decimal(0),
        complexity: new Decimal("0.2"),
      },
      simulation: simulationConfiguration,
    });

    expect(result.status).toBe("unsatisfied");
    expect(result.candidates).toHaveLength(0);
    expect(result.issues[0]?.code).toBe("quote_target_below_segment_minimum");
    expect(result.issues[0]?.message).toContain("0.000001 USDC (1 atomic unit)");
    expect(result.issues[0]?.message).toContain(
      `at least ${minimumQuote} USDC (${minimumAtomic} atomic units)`,
    );
    expect(result.issues[0]?.message).toContain("reduce $.solver.maxSegments to 1 or fewer");
  });
});
