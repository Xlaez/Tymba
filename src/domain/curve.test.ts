import { describe, expect, it } from "vitest";
import {
  MAX_CURVE_U128,
  MAX_CURVE_U64,
  MAX_PUBLIC_BUILDER_CURVE_ENTRIES,
  MAX_PUBLIC_BUILDER_SQRT_PRICE_BOUNDARIES,
  MAX_PUBLIC_BUILDER_SEGMENTS,
  validateDbcCurveShape,
  type DbcCurve,
} from "./curve.js";

const q64 = 1n << 64n;

const validCurve: DbcCurve = {
  baseDecimals: 9,
  quoteDecimals: 6,
  startSqrtPriceQ64x64: q64,
  migrationQuoteThresholdAtomic: 150_000_000_000n,
  segments: [
    { lowerSqrtPriceQ64x64: q64, upperSqrtPriceQ64x64: 2n * q64, liquidity: 500n },
    { lowerSqrtPriceQ64x64: 2n * q64, upperSqrtPriceQ64x64: 4n * q64, liquidity: 750n },
  ],
};

describe("validateDbcCurveShape", () => {
  it("accepts contiguous ascending Q64.64 segments with protocol-width values", () => {
    const result = validateDbcCurveShape(validCurve);

    expect(result).toEqual({ status: "valid", curve: validCurve });
  });

  it("accepts 16 segments compiled from 17 sqrt-price boundaries", () => {
    const segments = Array.from({ length: MAX_PUBLIC_BUILDER_SEGMENTS }, (_, index) => ({
      lowerSqrtPriceQ64x64: BigInt(index + 1) * q64,
      upperSqrtPriceQ64x64: BigInt(index + 2) * q64,
      liquidity: 1n,
    }));
    const result = validateDbcCurveShape({ ...validCurve, segments });

    expect(result.status).toBe("valid");
    expect(segments.length).toBe(MAX_PUBLIC_BUILDER_CURVE_ENTRIES);
    expect(segments.length + 1).toBe(MAX_PUBLIC_BUILDER_SQRT_PRICE_BOUNDARIES);
  });

  it("rejects too many segments and distinguishes the public-builder limit", () => {
    const segments = Array.from({ length: MAX_PUBLIC_BUILDER_SEGMENTS + 1 }, (_, index) => ({
      lowerSqrtPriceQ64x64: BigInt(index + 1) * q64,
      upperSqrtPriceQ64x64: BigInt(index + 2) * q64,
      liquidity: 1n,
    }));
    const result = validateDbcCurveShape({ ...validCurve, segments });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$.segments", code: "segment_count" }),
    );
  });

  it("rejects gaps, overlaps, descending bounds, and a mismatched curve start", () => {
    const result = validateDbcCurveShape({
      ...validCurve,
      startSqrtPriceQ64x64: 2n * q64,
      segments: [
        { lowerSqrtPriceQ64x64: q64, upperSqrtPriceQ64x64: 2n * q64, liquidity: 1n },
        { lowerSqrtPriceQ64x64: 3n * q64, upperSqrtPriceQ64x64: 2n * q64, liquidity: 1n },
      ],
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("start_price_mismatch");
    expect(codes).toContain("non_increasing_price");
    expect(codes).toContain("segment_gap_or_overlap");
  });

  it("rejects non-positive or oversized u128 prices and liquidity", () => {
    const result = validateDbcCurveShape({
      ...validCurve,
      startSqrtPriceQ64x64: 0n,
      segments: [
        {
          lowerSqrtPriceQ64x64: 0n,
          upperSqrtPriceQ64x64: MAX_CURVE_U128 + 1n,
          liquidity: 0n,
        },
      ],
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    expect(result.issues.filter((issue) => issue.code === "out_of_range")).toHaveLength(4);
  });

  it("rejects migration thresholds outside positive u64 atomic range", () => {
    const zero = validateDbcCurveShape({ ...validCurve, migrationQuoteThresholdAtomic: 0n });
    const overflow = validateDbcCurveShape({
      ...validCurve,
      migrationQuoteThresholdAtomic: MAX_CURVE_U64 + 1n,
    });

    expect(zero.status).toBe("invalid");
    expect(overflow.status).toBe("invalid");
  });

  it("rejects unsupported decimals and non-bigint protocol fields", () => {
    const result = validateDbcCurveShape({
      ...validCurve,
      baseDecimals: 10,
      quoteDecimals: 256,
      migrationQuoteThresholdAtomic: 100,
    });

    expect(result.status).toBe("invalid");
    if (result.status === "valid") return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("out_of_range");
    expect(codes).toContain("invalid_integer");
  });
});
