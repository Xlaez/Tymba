import {
  calculateQuoteToBaseFromAmountIn,
  fromDecimalToBN,
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getNextSqrtPriceFromBaseAmountInRoundingUp,
  getNextSqrtPriceFromBaseAmountOutRoundingUp,
  getNextSqrtPriceFromQuoteAmountInRoundingDown,
  getNextSqrtPriceFromQuoteAmountOutRoundingDown,
  Rounding,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { type CurveSegment, MAX_CURVE_U64, MAX_CURVE_U128 } from "./curve.js";
import { Q64_ONE, Q128_SCALE } from "./price.js";
import {
  baseDistributedForSegment,
  baseDistributedForSegments,
  baseRequiredForSegment,
  quoteDistributedForSegment,
  quoteRequiredForSegment,
  quoteRequiredForSegments,
  sqrtPriceAfterBaseInput,
  sqrtPriceAfterBaseOutput,
  sqrtPriceAfterQuoteInput,
  sqrtPriceAfterQuoteOutput,
} from "./segment-math.js";

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

describe("quote required for one curve segment", () => {
  it("computes the known exact quote amount", () => {
    const segment: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: 2n * Q64_ONE,
      liquidity: 4n * Q64_ONE,
    };

    expect(quoteRequiredForSegment(segment)).toBe(4n);
  });

  it("rounds required quote upward like the pinned SDK", () => {
    const segment: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: Q64_ONE + 1n,
      liquidity: Q64_ONE,
    };
    const sdkAmount = getDeltaAmountQuoteUnsigned(
      sdkInteger(segment.lowerSqrtPriceQ64x64),
      sdkInteger(segment.upperSqrtPriceQ64x64),
      sdkInteger(segment.liquidity),
      Rounding.Up,
    );

    expect(quoteRequiredForSegment(segment)).toBe(1n);
    expect(quoteRequiredForSegment(segment).toString()).toBe(sdkAmount.toString());
  });

  it("supports the protocol maximum u128 operands without intermediate overflow", () => {
    const segment: CurveSegment = {
      lowerSqrtPriceQ64x64: 1n,
      upperSqrtPriceQ64x64: MAX_CURVE_U128,
      liquidity: MAX_CURVE_U128,
    };

    expect(quoteRequiredForSegment(segment)).toBe(
      (MAX_CURVE_U128 * (MAX_CURVE_U128 - 1n) + Q128_SCALE - 1n) / Q128_SCALE,
    );
  });

  it("rejects invalid protocol bounds and liquidity", () => {
    const base: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: 2n * Q64_ONE,
      liquidity: 1n,
    };

    expect(() => quoteRequiredForSegment({ ...base, lowerSqrtPriceQ64x64: 0n })).toThrow(
      RangeError,
    );
    expect(() => quoteRequiredForSegment({ ...base, upperSqrtPriceQ64x64: Q64_ONE })).toThrow(
      RangeError,
    );
    expect(() =>
      quoteRequiredForSegment({ ...base, upperSqrtPriceQ64x64: MAX_CURVE_U128 + 1n }),
    ).toThrow(RangeError);
    expect(() => quoteRequiredForSegment({ ...base, liquidity: 0n })).toThrow(RangeError);
  });
});

describe("base distributed through one curve segment", () => {
  it("computes the known exact base amount", () => {
    const segment: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: 2n * Q64_ONE,
      liquidity: 4n * Q64_ONE,
    };

    expect(baseDistributedForSegment(segment)).toBe(2n);
  });

  it("rounds delivered base downward like the pinned SDK", () => {
    const segment: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: Q64_ONE + 1n,
      liquidity: Q64_ONE,
    };
    const sdkAmount = getDeltaAmountBaseUnsigned(
      sdkInteger(segment.lowerSqrtPriceQ64x64),
      sdkInteger(segment.upperSqrtPriceQ64x64),
      sdkInteger(segment.liquidity),
      Rounding.Down,
    );

    expect(baseDistributedForSegment(segment)).toBe(0n);
    expect(baseDistributedForSegment(segment).toString()).toBe(sdkAmount.toString());
    const sdkRequired = getDeltaAmountBaseUnsigned(
      sdkInteger(segment.lowerSqrtPriceQ64x64),
      sdkInteger(segment.upperSqrtPriceQ64x64),
      sdkInteger(segment.liquidity),
      Rounding.Up,
    );
    const sdkQuoteAmount = getDeltaAmountQuoteUnsigned(
      sdkInteger(segment.lowerSqrtPriceQ64x64),
      sdkInteger(segment.upperSqrtPriceQ64x64),
      sdkInteger(segment.liquidity),
      Rounding.Down,
    );
    expect(baseRequiredForSegment(segment)).toBe(1n);
    expect(baseRequiredForSegment(segment).toString()).toBe(sdkRequired.toString());
    expect(quoteDistributedForSegment(segment)).toBe(0n);
    expect(quoteDistributedForSegment(segment).toString()).toBe(sdkQuoteAmount.toString());
  });
});

describe("base distributed across curve segments", () => {
  it("adds each segment's downward-rounded base amount", () => {
    const segments: CurveSegment[] = [
      {
        lowerSqrtPriceQ64x64: Q64_ONE,
        upperSqrtPriceQ64x64: 2n * Q64_ONE,
        liquidity: 2n * Q64_ONE,
      },
      {
        lowerSqrtPriceQ64x64: 2n * Q64_ONE,
        upperSqrtPriceQ64x64: 3n * Q64_ONE,
        liquidity: 6n * Q64_ONE,
      },
    ];
    const sdkTotal = segments.reduce(
      (total, segment) =>
        total +
        BigInt(
          getDeltaAmountBaseUnsigned(
            sdkInteger(segment.lowerSqrtPriceQ64x64),
            sdkInteger(segment.upperSqrtPriceQ64x64),
            sdkInteger(segment.liquidity),
            Rounding.Down,
          ).toString(),
        ),
      0n,
    );

    expect(segments.map(baseDistributedForSegment)).toEqual([1n, 1n]);
    expect(baseDistributedForSegments(segments)).toBe(2n);
    expect(baseDistributedForSegments(segments)).toBe(sdkTotal);
    expect(() => baseDistributedForSegments([])).toThrow(RangeError);
  });
});

describe("inverse sqrt-price calculations", () => {
  it("matches the SDK for quote input and base output", () => {
    const liquidity = 4n * Q64_ONE;
    const quoteInputPrice = sqrtPriceAfterQuoteInput(Q64_ONE, liquidity, 4n);
    const baseOutputPrice = sqrtPriceAfterBaseOutput(Q64_ONE, liquidity, 1n);
    const sdkQuoteInputPrice = getNextSqrtPriceFromQuoteAmountInRoundingDown(
      sdkInteger(Q64_ONE),
      sdkInteger(liquidity),
      sdkInteger(4n),
    );
    const sdkBaseOutputPrice = getNextSqrtPriceFromBaseAmountOutRoundingUp(
      sdkInteger(Q64_ONE),
      sdkInteger(liquidity),
      sdkInteger(1n),
    );

    expect(quoteInputPrice).toBe(2n * Q64_ONE);
    expect(quoteInputPrice.toString()).toBe(sdkQuoteInputPrice.toString());
    expect(baseOutputPrice.toString()).toBe(sdkBaseOutputPrice.toString());
    expect(
      baseDistributedForSegment({
        lowerSqrtPriceQ64x64: Q64_ONE,
        upperSqrtPriceQ64x64: baseOutputPrice,
        liquidity,
      }),
    ).toBe(1n);
    expect(
      quoteRequiredForSegment({
        lowerSqrtPriceQ64x64: Q64_ONE,
        upperSqrtPriceQ64x64: baseOutputPrice,
        liquidity,
      }),
    ).toBe(2n);
  });

  it("matches the SDK for base input in both multiplication branches", () => {
    const ordinaryPrice = sqrtPriceAfterBaseInput(Q64_ONE, 4n * Q64_ONE, 1n);
    const overflowBranchPrice = sqrtPriceAfterBaseInput(MAX_CURVE_U128, MAX_CURVE_U128, 1n);
    const sdkOrdinaryPrice = getNextSqrtPriceFromBaseAmountInRoundingUp(
      sdkInteger(Q64_ONE),
      sdkInteger(4n * Q64_ONE),
      sdkInteger(1n),
    );
    const sdkOverflowBranchPrice = getNextSqrtPriceFromBaseAmountInRoundingUp(
      sdkInteger(MAX_CURVE_U128),
      sdkInteger(MAX_CURVE_U128),
      sdkInteger(1n),
    );

    expect(ordinaryPrice.toString()).toBe(sdkOrdinaryPrice.toString());
    expect(overflowBranchPrice.toString()).toBe(sdkOverflowBranchPrice.toString());
  });

  it("matches the SDK for quote output and rejects invalid reverse moves", () => {
    const price = sqrtPriceAfterQuoteOutput(2n * Q64_ONE, 4n * Q64_ONE, 1n);
    const sdkPrice = getNextSqrtPriceFromQuoteAmountOutRoundingDown(
      sdkInteger(2n * Q64_ONE),
      sdkInteger(4n * Q64_ONE),
      sdkInteger(1n),
    );

    expect(price.toString()).toBe(sdkPrice.toString());
    expect(sqrtPriceAfterBaseOutput(Q64_ONE, 4n * Q64_ONE, 0n)).toBe(Q64_ONE);
    expect(sqrtPriceAfterBaseInput(Q64_ONE, 4n * Q64_ONE, 0n)).toBe(Q64_ONE);
    expect(() => sqrtPriceAfterBaseOutput(Q64_ONE, Q64_ONE, 1n)).toThrow(RangeError);
    expect(() => sqrtPriceAfterQuoteOutput(Q64_ONE, Q64_ONE, 1n)).toThrow(RangeError);
    expect(() => sqrtPriceAfterQuoteInput(Q64_ONE, Q64_ONE, -1n)).toThrow(RangeError);
    expect(() => sqrtPriceAfterQuoteInput(Q64_ONE, Q64_ONE, MAX_CURVE_U64 + 1n)).toThrow(
      RangeError,
    );
  });
});

describe("quote required across curve segments", () => {
  it("accumulates each rounded segment quote and matches the pinned SDK", () => {
    const segments: CurveSegment[] = [
      {
        lowerSqrtPriceQ64x64: Q64_ONE,
        upperSqrtPriceQ64x64: 2n * Q64_ONE,
        liquidity: 2n * Q64_ONE,
      },
      {
        lowerSqrtPriceQ64x64: 2n * Q64_ONE,
        upperSqrtPriceQ64x64: 3n * Q64_ONE,
        liquidity: 6n * Q64_ONE,
      },
    ];
    const accumulatedQuote = quoteRequiredForSegments(segments);
    const sdkResult = calculateQuoteToBaseFromAmountIn(
      {
        curve: segments.map((segment) => ({
          sqrtPrice: sdkInteger(segment.upperSqrtPriceQ64x64),
          liquidity: sdkInteger(segment.liquidity),
        })),
      },
      sdkInteger(Q64_ONE),
      sdkInteger(accumulatedQuote),
      sdkInteger(3n * Q64_ONE),
    );

    expect(segments.map(quoteRequiredForSegment)).toEqual([2n, 6n]);
    expect(accumulatedQuote).toBe(8n);
    expect(sdkResult.amountLeft.toString()).toBe("0");
    expect(sdkResult.outputAmount.toString()).toBe("2");
  });

  it("preserves upward rounding for each segment and rejects invalid topology", () => {
    const first: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: Q64_ONE + 1n,
      liquidity: Q64_ONE,
    };
    const second: CurveSegment = {
      lowerSqrtPriceQ64x64: Q64_ONE + 1n,
      upperSqrtPriceQ64x64: Q64_ONE + 2n,
      liquidity: Q64_ONE,
    };

    expect(quoteRequiredForSegments([first, second])).toBe(2n);
    expect(() => quoteRequiredForSegments([])).toThrow(RangeError);
    expect(() =>
      quoteRequiredForSegments([first, { ...second, lowerSqrtPriceQ64x64: 2n * Q64_ONE }]),
    ).toThrow(RangeError);
  });
});
