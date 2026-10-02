import { describe, expect, it } from "vitest";
import { type CurveSegment, type DbcCurve, validateDbcCurveShape } from "./curve.js";
import { quoteBuy, quoteSell } from "./curve-swap.js";
import { feeNumeratorFromBps, feeOnIncludedAmount } from "./fee-math.js";
import {
  baseDistributedForSegment,
  baseDistributedForSegments,
  quoteRequiredForSegment,
  quoteRequiredForSegments,
  sqrtPriceAfterBaseInput,
  sqrtPriceAfterQuoteInput,
} from "./segment-math.js";
import { Q64_ONE } from "./price.js";

function generatedCurve(segmentCount: number): DbcCurve {
  const segments: CurveSegment[] = Array.from({ length: segmentCount }, (_, index) => ({
    lowerSqrtPriceQ64x64: BigInt(index + 1) * Q64_ONE,
    upperSqrtPriceQ64x64: BigInt(index + 2) * Q64_ONE,
    liquidity: Q64_ONE * 1_000_000n * BigInt(index + 1),
  }));
  const quoteCapacity = segments.reduce(
    (total, segment) => total + quoteRequiredForSegment(segment),
    0n,
  );

  return {
    baseDecimals: 9,
    quoteDecimals: 6,
    startSqrtPriceQ64x64: Q64_ONE,
    migrationQuoteThresholdAtomic: quoteCapacity,
    segments,
  };
}

describe("curve math properties", () => {
  it("reduces fixed-input price movement as liquidity increases", () => {
    let previousQuoteMovement: bigint | undefined;
    let previousBaseMovement: bigint | undefined;

    for (let scale = 1n; scale <= 32n; scale += 1n) {
      const liquidity = Q64_ONE * 1_000n * scale;
      const quoteNext = sqrtPriceAfterQuoteInput(Q64_ONE, liquidity, 100n);
      const baseNext = sqrtPriceAfterBaseInput(Q64_ONE, liquidity, 100n);
      const quoteMovement = quoteNext - Q64_ONE;
      const baseMovement = Q64_ONE - baseNext;

      if (previousQuoteMovement !== undefined) {
        expect(quoteMovement).toBeLessThanOrEqual(previousQuoteMovement);
        expect(baseMovement).toBeLessThanOrEqual(previousBaseMovement ?? 0n);
      }

      previousQuoteMovement = quoteMovement;
      previousBaseMovement = baseMovement;
    }
  });

  it("keeps generated segment ordering valid and trade prices monotonic", () => {
    for (let segmentCount = 1; segmentCount <= 16; segmentCount += 1) {
      const curve = generatedCurve(segmentCount);
      const validation = validateDbcCurveShape(curve);

      expect(validation.status).toBe("valid");
      if (validation.status !== "valid") continue;

      let buyPrice = curve.startSqrtPriceQ64x64;
      for (let trade = 0; trade < 8; trade += 1) {
        const result = quoteBuy(validation.curve, 10_000n, buyPrice);
        expect(result.nextSqrtPriceQ64x64).toBeGreaterThanOrEqual(buyPrice);
        buyPrice = result.nextSqrtPriceQ64x64;
      }

      let sellPrice =
        validation.curve.segments[validation.curve.segments.length - 1]?.upperSqrtPriceQ64x64 ??
        validation.curve.startSqrtPriceQ64x64;
      for (let trade = 0; trade < 8; trade += 1) {
        const result = quoteSell(validation.curve, 10_000n, sellPrice);
        expect(result.nextSqrtPriceQ64x64).toBeLessThanOrEqual(sellPrice);
        expect(result.nextSqrtPriceQ64x64).toBeGreaterThanOrEqual(
          validation.curve.startSqrtPriceQ64x64,
        );
        sellPrice = result.nextSqrtPriceQ64x64;
      }
    }
  });

  it("approximately reverses a buy with a sell within a fixture-specific rounding bound", () => {
    const curve = generatedCurve(1);
    const inputQuote = 33_333n;
    const buy = quoteBuy(curve, inputQuote);
    const sell = quoteSell(curve, buy.outputAtomic, buy.nextSqrtPriceQ64x64);

    expect(buy.outputAtomic).toBeGreaterThan(0n);
    expect(sell.outputAtomic).toBeLessThanOrEqual(inputQuote);
    expect(inputQuote - sell.outputAtomic).toBeLessThanOrEqual(4n);
    expect(sell.nextSqrtPriceQ64x64).toBeGreaterThanOrEqual(curve.startSqrtPriceQ64x64);
    expect(sell.nextSqrtPriceQ64x64).toBeLessThanOrEqual(buy.nextSqrtPriceQ64x64);
  });

  it("accounts separately for buy fees, sell fees, and curve-rounding loss", () => {
    const curve = generatedCurve(1);
    const requestedQuote = 33_333n;
    const feeNumerator = feeNumeratorFromBps(100n);
    const buyFee = feeOnIncludedAmount(requestedQuote, feeNumerator);
    const buy = quoteBuy(curve, buyFee.netAmountAtomic);
    const sell = quoteSell(curve, buy.outputAtomic, buy.nextSqrtPriceQ64x64);
    const sellFee = feeOnIncludedAmount(sell.outputAtomic, feeNumerator);
    const quoteReturned = sellFee.netAmountAtomic;

    expect(sell.outputAtomic).toBeLessThanOrEqual(buyFee.netAmountAtomic);
    expect(quoteReturned).toBeLessThan(sell.outputAtomic);
    expect(requestedQuote - quoteReturned).toBe(
      buyFee.totalFeeAtomic + (buyFee.netAmountAtomic - sell.outputAtomic) + sellFee.totalFeeAtomic,
    );
  });

  it("makes multi-segment accumulations equal their individually rounded calculations", () => {
    for (let segmentCount = 1; segmentCount <= 16; segmentCount += 1) {
      const segments = generatedCurve(segmentCount).segments;
      const quoteSum = segments.reduce(
        (total, segment) => total + quoteRequiredForSegment(segment),
        0n,
      );
      const baseSum = segments.reduce(
        (total, segment) => total + baseDistributedForSegment(segment),
        0n,
      );

      expect(quoteRequiredForSegments(segments)).toBe(quoteSum);
      expect(baseDistributedForSegments(segments)).toBe(baseSum);
    }
  });
});
