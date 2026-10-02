import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { deterministicCoordinateSearch } from "./deterministic-optimizer.js";

const firstDimension = {
  name: "first",
  initialValue: new Decimal("0.5"),
  minimum: new Decimal("0"),
  maximum: new Decimal("1"),
};
const secondDimension = {
  name: "second",
  initialValue: new Decimal("0.5"),
  minimum: new Decimal("0"),
  maximum: new Decimal("1"),
};
const dimensions = [firstDimension, secondDimension];

function objective(values: readonly Decimal[]): Decimal {
  const first = values[0];
  const second = values[1];
  if (first === undefined || second === undefined) throw new Error("Expected two dimensions");
  return first.minus("0.25").pow(2).plus(second.minus("0.75").pow(2));
}

describe("deterministicCoordinateSearch", () => {
  it("improves a bounded objective and produces identical results for identical inputs", () => {
    const first = deterministicCoordinateSearch(dimensions, objective);
    const second = deterministicCoordinateSearch(dimensions, objective);

    expect(first.values.map(({ value }) => value.toFixed())).toEqual(["0.25", "0.75"]);
    expect(first.objectiveScore.toFixed()).toBe("0");
    expect(first.values.map(({ value }) => value.toFixed())).toEqual(
      second.values.map(({ value }) => value.toFixed()),
    );
    expect(first.objectiveScore.toFixed()).toBe(second.objectiveScore.toFixed());
    expect(first.objectiveEvaluations).toBe(second.objectiveEvaluations);
  });

  it("returns the objective for a problem with no remaining free variables", () => {
    const result = deterministicCoordinateSearch([], () => new Decimal("7"));

    expect(result.values).toEqual([]);
    expect(result.objectiveScore.toFixed()).toBe("7");
    expect(result.iterations).toBe(0);
    expect(result.objectiveEvaluations).toBe(1);
  });

  it("rejects invalid dimensions, bounds, iteration counts, and objective values", () => {
    expect(() =>
      deterministicCoordinateSearch(
        [
          { ...firstDimension, name: "same" },
          { ...secondDimension, name: "same" },
        ],
        objective,
      ),
    ).toThrow("Duplicate optimization dimension");

    expect(() =>
      deterministicCoordinateSearch(
        [{ ...firstDimension, initialValue: new Decimal("2") }],
        () => new Decimal("0"),
      ),
    ).toThrow("within its bounds");

    expect(() =>
      deterministicCoordinateSearch(dimensions, objective, { maxIterations: 0 }),
    ).toThrow(RangeError);

    expect(() => deterministicCoordinateSearch(dimensions, () => new Decimal("NaN"))).toThrow(
      "must be finite",
    );
  });
});
