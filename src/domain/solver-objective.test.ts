import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  evaluateSolverObjective,
  type SolverObjectiveMeasurements,
  type SolverObjectiveWeights,
} from "./solver-objective.js";

const weights: SolverObjectiveWeights = {
  quoteError: new Decimal("0.2"),
  distributionError: new Decimal("0.2"),
  migrationPriceError: new Decimal("0.2"),
  earlyPriceImpact: new Decimal("0.2"),
  attackProfitability: new Decimal("0.1"),
  complexity: new Decimal("0.1"),
};

const measurements: SolverObjectiveMeasurements = {
  quoteTargetAtomic: 100n,
  quoteAchievedAtomic: 120n,
  distributionTargetBps: 2_500n,
  distributionAchievedBps: 3_500n,
  migrationPriceTarget: new Decimal("2"),
  migrationPriceAchieved: new Decimal("3"),
  earlyPriceImpactBps: 600n,
  maxEarlyPriceImpactBps: 400n,
  earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
  earlyPriceImpactEvidenceId: "simulation-1",
  attackerProfitQuoteAtomic: 50n,
  attackerCapitalQuoteAtomic: 500n,
  attackEvidenceId: "attack-1",
  segmentCount: 2,
  maxSegments: 4,
};

describe("evaluateSolverObjective", () => {
  it("combines all six normalized penalties with explicit weights", () => {
    const result = evaluateSolverObjective(weights, measurements);

    expect(result.score.toFixed()).toBe("0.224");
    expect(result.terms.quoteError.normalizedPenalty?.toFixed()).toBe("0.2");
    expect(result.terms.distributionError.normalizedPenalty?.toFixed()).toBe("0.1");
    expect(result.terms.migrationPriceError.normalizedPenalty?.toFixed()).toBe("0.5");
    expect(result.terms.earlyPriceImpact.normalizedPenalty?.toFixed()).toBe("0.02");
    expect(result.terms.attackProfitability.normalizedPenalty?.toFixed()).toBe("0.1");
    expect(result.terms.complexity.normalizedPenalty?.toFixed()).toBe("0.5");
    expect(result.measurements.earlyPriceImpactProbeQuoteAtomic).toBe(5_000_000_000n);
    expect(result.measurements.attackEvidenceId).toBe("attack-1");
  });

  it("requires explicit weights and measurements only for active terms", () => {
    const availableMeasurements = omitMeasurements(
      "earlyPriceImpactBps",
      "maxEarlyPriceImpactBps",
      "earlyPriceImpactProbeQuoteAtomic",
      "earlyPriceImpactEvidenceId",
      "attackerProfitQuoteAtomic",
      "attackerCapitalQuoteAtomic",
      "attackEvidenceId",
    );
    const normalizedKnownWeights: SolverObjectiveWeights = {
      quoteError: new Decimal("0.25"),
      distributionError: new Decimal("0.25"),
      migrationPriceError: new Decimal("0.25"),
      earlyPriceImpact: new Decimal(0),
      attackProfitability: new Decimal(0),
      complexity: new Decimal("0.25"),
    };

    const result = evaluateSolverObjective(normalizedKnownWeights, availableMeasurements);
    expect(result.terms.earlyPriceImpact.normalizedPenalty).toBeUndefined();
    expect(result.terms.attackProfitability.normalizedPenalty).toBeUndefined();
    expect(result.terms.earlyPriceImpact.weightedPenalty.toFixed()).toBe("0");
    expect(result.terms.attackProfitability.weightedPenalty.toFixed()).toBe("0");
  });

  it("rejects missing measurements for positively weighted terms", () => {
    expect(() =>
      evaluateSolverObjective(weights, omitMeasurements("attackerProfitQuoteAtomic")),
    ).toThrow("Measurements for positively weighted attackProfitability are required");

    expect(() =>
      evaluateSolverObjective(weights, omitMeasurements("earlyPriceImpactProbeQuoteAtomic")),
    ).toThrow("Measurements for positively weighted earlyPriceImpact are required");
  });

  it("requires objective weights to be explicit, non-negative, and normalized", () => {
    expect(() => evaluateSolverObjective(undefined as never, measurements)).toThrow(
      "Objective weights must be an object",
    );
    expect(() =>
      evaluateSolverObjective({ ...weights, complexity: new Decimal("-0.1") }, measurements),
    ).toThrow("complexity weight must not be negative");
    expect(() =>
      evaluateSolverObjective({ ...weights, complexity: new Decimal("0.2") }, measurements),
    ).toThrow("Objective weights must sum exactly to one");
  });

  it("does not reward negative attacker profit and validates probe and complexity bounds", () => {
    const result = evaluateSolverObjective(weights, {
      ...measurements,
      attackerProfitQuoteAtomic: -50n,
    });
    expect(result.terms.attackProfitability.normalizedPenalty?.toFixed()).toBe("0");

    expect(() =>
      evaluateSolverObjective(weights, {
        ...measurements,
        earlyPriceImpactProbeQuoteAtomic: 0n,
      }),
    ).toThrow("Early price-impact probe must be a positive u64 amount");
    expect(() =>
      evaluateSolverObjective(weights, {
        ...measurements,
        segmentCount: 5,
      }),
    ).toThrow("Segment count must not exceed maximum segment count");
  });
});

function omitMeasurements(...keys: readonly string[]): SolverObjectiveMeasurements {
  const result: Record<string, unknown> = { ...measurements };
  for (const key of keys) delete result[key];
  return result as SolverObjectiveMeasurements;
}
