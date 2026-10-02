import { describe, expect, it } from "vitest";
import { createConstraintConflictWarning, deriveSolverStatus } from "./solver-result.js";

describe("deriveSolverStatus", () => {
  it("returns unsatisfied when no feasible candidate exists", () => {
    expect(deriveSolverStatus([])).toBe("unsatisfied");
  });

  it("returns satisfied when a candidate meets every requested constraint", () => {
    expect(deriveSolverStatus([{ candidateId: "candidate-1", unmetConstraintCodes: [] }])).toBe(
      "satisfied",
    );
  });

  it("returns partial when feasible candidates leave requested constraints unmet", () => {
    expect(
      deriveSolverStatus([
        { candidateId: "candidate-1", unmetConstraintCodes: ["quote_target"] },
        { candidateId: "candidate-2", unmetConstraintCodes: ["distribution_target"] },
      ]),
    ).toBe("partial");
  });

  it("returns satisfied if at least one candidate meets all requested constraints", () => {
    expect(
      deriveSolverStatus([
        { candidateId: "candidate-1", unmetConstraintCodes: ["quote_target"] },
        { candidateId: "candidate-2", unmetConstraintCodes: [] },
      ]),
    ).toBe("satisfied");
  });
});

describe("createConstraintConflictWarning", () => {
  it("explains an economic shortfall and gives a measurable alternative", () => {
    const warning = createConstraintConflictWarning({
      constraint: "quote_to_migration",
      path: "$.targets.quoteToMigration",
      target: "150000",
      achieved: "142500",
      unit: "USDC",
      candidateId: "candidate-1",
    });

    expect(warning.code).toBe("target_not_met");
    expect(warning.message).toBe(
      "Capital before graduation: requested 150000 USDC, while this candidate measures 142500 USDC (-7500 USDC versus target, below target). To consider this candidate, revise the requested value to 142500 USDC.",
    );
    expect(warning.alternatives).toEqual([
      {
        path: "$.targets.quoteToMigration",
        suggestedValue: "142500",
        unit: "USDC",
        explanation: expect.stringContaining("does not guarantee another compilation"),
      },
    ]);
    expect(warning.candidateId).toBe("candidate-1");
  });

  it("computes differences without converting economic decimals to JavaScript numbers", () => {
    const warning = createConstraintConflictWarning({
      constraint: "migration_price",
      path: "$.pricing.migrationPrice",
      target: "9007199254740993.123",
      achieved: "9007199254740993.122",
      unit: "USDC/MKT",
    });

    expect(warning.message).toContain("-0.001 USDC/MKT versus target, below target");
    expect(warning.alternatives?.[0]?.suggestedValue).toBe("9007199254740993.122");
  });

  it("explains when the achieved value exceeds the target", () => {
    const warning = createConstraintConflictWarning({
      constraint: "base_distribution",
      path: "$.targets.baseDistributionPct",
      target: "25",
      achieved: "26.25",
      unit: "%",
    });

    expect(warning.message).toContain("+1.25 % versus target, above target");
    expect(warning.alternatives?.[0]?.suggestedValue).toBe("26.25");
  });

  it("rejects satisfied, malformed, negative, and unitless conflicts", () => {
    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration",
        target: "10",
        achieved: "10",
        unit: "USDC",
      }),
    ).toThrow("not a constraint conflict");

    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration",
        target: "1e3",
        achieved: "900",
        unit: "USDC",
      }),
    ).toThrow("plain decimal string");

    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration",
        target: "-1",
        achieved: "0",
        unit: "USDC",
      }),
    ).toThrow("plain decimal string");

    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration",
        target: "1",
        achieved: "0",
        unit: " ",
      }),
    ).toThrow("unit must be non-empty");

    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration\nFORGED",
        target: "1",
        achieved: "0",
        unit: "USDC",
      }),
    ).toThrow("absolute field path");

    expect(() =>
      createConstraintConflictWarning({
        constraint: "quote_to_migration",
        path: "$.targets.quoteToMigration",
        target: "1",
        achieved: "0",
        unit: "USDC\nINJECTED",
      }),
    ).toThrow("control characters");
  });
});
