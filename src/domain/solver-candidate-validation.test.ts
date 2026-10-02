import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { MAX_CURVE_U128, MAX_CURVE_U64 } from "./curve.js";
import { validateMarketIntent } from "./market-intent.js";
import { generateInitialPriceBreakpoints } from "./solver-candidate-generation.js";
import { validateCandidateCurve } from "./solver-candidate-validation.js";

const marketIntent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startFdv: "200000", migrationFdv: "2000000" },
  targets: {},
};

function normalizedMarket(totalBase = "1000000000", maxSegments = 3) {
  const result = validateMarketIntent({
    ...marketIntent,
    supply: { totalBase },
    solver: { maxSegments },
  });
  if (result.status === "invalid") throw new Error("Test market intent must be valid");
  return result.normalized;
}

function validDraft() {
  const market = normalizedMarket();
  return {
    market,
    priceBreakpoints: generateInitialPriceBreakpoints(market),
    segmentLiquidities: [1n, 1n, 1n],
    migrationQuoteThresholdAtomic: 1n,
  };
}

function draftWithSegmentCount(segmentCount: number, maximumSegments = segmentCount) {
  const market = normalizedMarket("1000000000", maximumSegments);
  const span = market.migrationPrice.minus(market.startPrice);
  const priceBreakpoints = Array.from({ length: segmentCount + 1 }, (_, index) =>
    market.startPrice.plus(span.mul(index.toString()).div(segmentCount.toString())),
  );
  return {
    market,
    priceBreakpoints,
    segmentLiquidities: Array.from({ length: segmentCount }, () => 1n),
    migrationQuoteThresholdAtomic: 1n,
  };
}

describe("validateCandidateCurve", () => {
  it("returns a structurally valid contiguous curve and measured supply/capacity", () => {
    const result = validateCandidateCurve(validDraft());

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.curve.segments).toHaveLength(3);
    expect(result.curve.startSqrtPriceQ64x64).toBe(result.curve.segments[0]?.lowerSqrtPriceQ64x64);
    expect(result.quoteCapacityAtomic).toBe(3n);
    expect(result.baseDistributedAtomic).toBe(0n);
  });

  it("enforces segment count, boundary count, and positive u128 liquidity", () => {
    const market = normalizedMarket("1000000000", 2);
    const tooManySegments = validateCandidateCurve({
      ...validDraft(),
      market,
      priceBreakpoints: generateInitialPriceBreakpoints(market),
      segmentLiquidities: [1n, 1n, 1n],
    });
    const badLiquidity = validateCandidateCurve({
      ...validDraft(),
      segmentLiquidities: [1n, 0n, 1n],
    });

    expect(tooManySegments.status).toBe("invalid");
    if (tooManySegments.status === "invalid") {
      expect(tooManySegments.issues.map(({ code }) => code)).toContain("segment_count");
      expect(tooManySegments.issues.map(({ code }) => code)).toContain("boundary_count");
    }
    expect(badLiquidity.status).toBe("invalid");
    if (badLiquidity.status === "invalid") {
      expect(badLiquidity.issues).toContainEqual(
        expect.objectContaining({ path: "$.segmentLiquidities[1]", code: "invalid_liquidity" }),
      );
    }
  });

  it("accepts the minimum and maximum supported segment counts", () => {
    const minimum = validateCandidateCurve(draftWithSegmentCount(1));
    const maximum = validateCandidateCurve(draftWithSegmentCount(16));
    const overMaximum = validateCandidateCurve(draftWithSegmentCount(17, 16));

    expect(minimum.status).toBe("valid");
    expect(maximum.status).toBe("valid");
    if (maximum.status === "valid") expect(maximum.curve.segments).toHaveLength(16);
    expect(overMaximum.status).toBe("invalid");
    if (overMaximum.status === "invalid") {
      expect(overMaximum.issues.map(({ code }) => code)).toContain("protocol_segment_limit");
    }
  });

  it("accepts minimum and maximum u128 liquidity and rejects values above the maximum", () => {
    const minimum = validateCandidateCurve({ ...validDraft(), segmentLiquidities: [1n, 1n, 1n] });
    const maximumMarketResult = validateMarketIntent({
      ...marketIntent,
      pricing: { startPrice: "1", migrationPrice: "1.00000000000000001" },
      targets: {},
      solver: { maxSegments: 1 },
    });
    if (maximumMarketResult.status === "invalid") throw new Error("Test intent must be valid");
    const maximumDraft = {
      market: maximumMarketResult.normalized,
      priceBreakpoints: generateInitialPriceBreakpoints(maximumMarketResult.normalized),
      segmentLiquidities: [MAX_CURVE_U128],
      migrationQuoteThresholdAtomic: 1n,
    };
    const maximum = validateCandidateCurve(maximumDraft);
    const overMaximum = validateCandidateCurve({
      ...maximumDraft,
      segmentLiquidities: [MAX_CURVE_U128 + 1n],
    });

    expect(minimum.status).toBe("valid");
    expect(maximum.status).toBe("valid");
    expect(overMaximum.status).toBe("invalid");
    if (overMaximum.status === "invalid") {
      expect(overMaximum.issues.map(({ code }) => code)).toContain("invalid_liquidity");
    }
  });

  it("rejects a migration threshold above curve quote capacity", () => {
    const result = validateCandidateCurve({ ...validDraft(), migrationQuoteThresholdAtomic: 4n });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "threshold_exceeds_curve_capacity" }),
      );
    }
  });

  it("rejects invalid total supply bounds and curve distribution above total supply", () => {
    const draft = validDraft();
    const oversizedSupply = validateCandidateCurve({
      ...draft,
      market: { ...draft.market, totalBaseAtomic: MAX_CURVE_U64 + 1n },
    });
    const oversoldCurve = validateCandidateCurve({
      ...draft,
      market: { ...draft.market, totalBaseAtomic: 1n },
      segmentLiquidities: [1n << 120n, 1n << 120n, 1n << 120n],
    });

    expect(oversizedSupply.status).toBe("invalid");
    if (oversizedSupply.status === "invalid") {
      expect(oversizedSupply.issues).toContainEqual(
        expect.objectContaining({ code: "supply_out_of_range" }),
      );
    }
    expect(oversoldCurve.status).toBe("invalid");
    if (oversoldCurve.status === "invalid") {
      expect(oversoldCurve.issues).toContainEqual(
        expect.objectContaining({ code: "supply_exceeded" }),
      );
    }
  });

  it("rejects economic or quantized boundaries that are not strictly increasing", () => {
    const draft = validDraft();
    const first = draft.priceBreakpoints[0];
    const second = draft.priceBreakpoints[1];
    const final = draft.priceBreakpoints[3];
    if (!first || !second || !final) throw new Error("Expected four price boundaries");
    const duplicate = validateCandidateCurve({
      ...draft,
      priceBreakpoints: [first, second, second, final],
    });
    const collapsedMarket = {
      ...draft.market,
      startPrice: new Decimal("1"),
      migrationPrice: new Decimal("1.000000000000000000000001"),
      maxSegments: 1,
    };
    const collapsed = validateCandidateCurve({
      market: collapsedMarket,
      priceBreakpoints: [collapsedMarket.startPrice, collapsedMarket.migrationPrice],
      segmentLiquidities: [1n],
      migrationQuoteThresholdAtomic: 1n,
    });

    expect(duplicate.status).toBe("invalid");
    if (duplicate.status === "invalid") {
      expect(duplicate.issues.map(({ code }) => code)).toContain("non_increasing_price");
    }
    expect(collapsed.status).toBe("invalid");
    if (collapsed.status === "invalid") {
      expect(collapsed.issues.map(({ code }) => code)).toContain("quantized_price_not_increasing");
    }
  });
});
