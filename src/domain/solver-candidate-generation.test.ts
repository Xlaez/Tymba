import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  generateInitialPriceBreakpoints,
  initialCandidateSegmentCount,
} from "./solver-candidate-generation.js";

const market = (maxSegments = 3) => ({
  startPrice: new Decimal("0.0002"),
  migrationPrice: new Decimal("0.002"),
  maxSegments,
});

describe("initialCandidateSegmentCount", () => {
  it("starts with three segments by default", () => {
    expect(initialCandidateSegmentCount()).toBe(3);
    expect(initialCandidateSegmentCount(16)).toBe(3);
    expect(initialCandidateSegmentCount(3)).toBe(3);
  });

  it("respects smaller segment limits", () => {
    expect(initialCandidateSegmentCount(1)).toBe(1);
    expect(initialCandidateSegmentCount(2)).toBe(2);
  });

  it("rejects segment limits outside the public-builder range", () => {
    expect(() => initialCandidateSegmentCount(0)).toThrow(RangeError);
    expect(() => initialCandidateSegmentCount(17)).toThrow(RangeError);
    expect(() => initialCandidateSegmentCount(1.5)).toThrow(RangeError);
    expect(() => initialCandidateSegmentCount(Number.NaN)).toThrow(RangeError);
  });
});

describe("generateInitialPriceBreakpoints", () => {
  it("generates increasing, evenly spaced prices including both exact endpoints", () => {
    const prices = generateInitialPriceBreakpoints(market());

    expect(prices.map((price) => price.toFixed())).toEqual(["0.0002", "0.0008", "0.0014", "0.002"]);
    const precedingPrices = prices.slice(0, -1);
    const followingPrices = prices.slice(1);
    expect(followingPrices.every((price, index) => price.gt(precedingPrices[index] ?? price))).toBe(
      true,
    );
  });

  it("respects smaller limits and retains the fixed initial count under larger limits", () => {
    expect(generateInitialPriceBreakpoints(market(1))).toHaveLength(2);
    expect(generateInitialPriceBreakpoints(market(2))).toHaveLength(3);
    expect(generateInitialPriceBreakpoints(market(16))).toHaveLength(4);
  });

  it("rejects non-increasing prices and interior points that collapse at solver precision", () => {
    expect(() =>
      generateInitialPriceBreakpoints({
        ...market(),
        migrationPrice: new Decimal("0.0002"),
      }),
    ).toThrow("Migration price must be greater than start price");

    const nearlyEqual = {
      startPrice: new Decimal("1"),
      migrationPrice: new Decimal(`1.${"0".repeat(511)}1`),
      maxSegments: 3,
    };
    expect(() => generateInitialPriceBreakpoints(nearlyEqual)).toThrow(
      "not distinct at solver precision",
    );
  });
});
