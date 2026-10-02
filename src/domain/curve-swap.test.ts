import {
  calculateBaseToQuoteFromAmountIn,
  calculateQuoteToBaseFromAmountIn,
  fromDecimalToBN,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import type { CurveSegment, DbcCurve } from "./curve.js";
import { quoteBuy, quoteSell } from "./curve-swap.js";
import { Q64_ONE } from "./price.js";

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

const segments: readonly CurveSegment[] = [
  {
    lowerSqrtPriceQ64x64: Q64_ONE,
    upperSqrtPriceQ64x64: 2n * Q64_ONE,
    liquidity: 2n * Q64_ONE,
  },
  {
    lowerSqrtPriceQ64x64: 2n * Q64_ONE,
    upperSqrtPriceQ64x64: 3n * Q64_ONE,
    liquidity: 12n * Q64_ONE,
  },
];

const curve: DbcCurve = {
  baseDecimals: 9,
  quoteDecimals: 6,
  startSqrtPriceQ64x64: Q64_ONE,
  migrationQuoteThresholdAtomic: 100n,
  segments,
};

const sdkCurve = segments.map((segment) => ({
  sqrtPrice: sdkInteger(segment.upperSqrtPriceQ64x64),
  liquidity: sdkInteger(segment.liquidity),
}));

describe("buy quotes across curve segments", () => {
  it("handles exact segment boundaries and full curve traversal", () => {
    const boundary = quoteBuy(curve, 2n);
    const complete = quoteBuy(curve, 14n);

    expect(boundary).toEqual({
      requestedInputAtomic: 2n,
      consumedInputAtomic: 2n,
      unfilledInputAtomic: 0n,
      outputAtomic: 1n,
      nextSqrtPriceQ64x64: 2n * Q64_ONE,
    });
    expect(complete.outputAtomic).toBe(3n);
    expect(complete.nextSqrtPriceQ64x64).toBe(3n * Q64_ONE);
    expect(complete.unfilledInputAtomic).toBe(0n);
  });

  it("matches the SDK for an input spanning multiple segments and for curve exhaustion", () => {
    const local = quoteBuy(curve, 8n);
    const sdk = calculateQuoteToBaseFromAmountIn(
      { curve: sdkCurve },
      sdkInteger(curve.startSqrtPriceQ64x64),
      sdkInteger(8n),
      sdkInteger(3n * Q64_ONE),
    );
    const exhausted = quoteBuy(curve, 17n);
    const sdkExhausted = calculateQuoteToBaseFromAmountIn(
      { curve: sdkCurve },
      sdkInteger(curve.startSqrtPriceQ64x64),
      sdkInteger(17n),
      sdkInteger(3n * Q64_ONE),
    );

    expect(local.outputAtomic.toString()).toBe(sdk.outputAmount.toString());
    expect(local.nextSqrtPriceQ64x64.toString()).toBe(sdk.nextSqrtPrice.toString());
    expect(local.unfilledInputAtomic.toString()).toBe(sdk.amountLeft.toString());
    expect(exhausted.unfilledInputAtomic.toString()).toBe(sdkExhausted.amountLeft.toString());
    expect(exhausted.consumedInputAtomic).toBe(14n);
  });

  it("quotes from a price inside a segment and rejects input outside the curve", () => {
    const currentPrice = Q64_ONE + Q64_ONE / 2n;
    const local = quoteBuy(curve, 1n, currentPrice);
    const sdk = calculateQuoteToBaseFromAmountIn(
      { curve: sdkCurve },
      sdkInteger(currentPrice),
      sdkInteger(1n),
      sdkInteger(3n * Q64_ONE),
    );

    expect(local.outputAtomic.toString()).toBe(sdk.outputAmount.toString());
    expect(local.nextSqrtPriceQ64x64.toString()).toBe(sdk.nextSqrtPrice.toString());

    const laterPrice = 2n * Q64_ONE + Q64_ONE / 2n;
    const laterLocal = quoteBuy(curve, 5n, laterPrice);
    const laterSdk = calculateQuoteToBaseFromAmountIn(
      { curve: sdkCurve },
      sdkInteger(laterPrice),
      sdkInteger(5n),
      sdkInteger(3n * Q64_ONE),
    );

    expect(laterLocal.outputAtomic.toString()).toBe(laterSdk.outputAmount.toString());
    expect(laterLocal.nextSqrtPriceQ64x64.toString()).toBe(laterSdk.nextSqrtPrice.toString());
    expect(() => quoteBuy(curve, 1n, 4n * Q64_ONE)).toThrow(RangeError);
  });

  it("stops at an explicit migration price and leaves remaining input unfilled", () => {
    const stopPrice = 2n * Q64_ONE;
    const quote = quoteBuy(curve, 8n, curve.startSqrtPriceQ64x64, stopPrice);

    expect(quote).toEqual({
      requestedInputAtomic: 8n,
      consumedInputAtomic: 2n,
      unfilledInputAtomic: 6n,
      outputAtomic: 1n,
      nextSqrtPriceQ64x64: stopPrice,
    });
  });
});

describe("sell quotes across curve segments", () => {
  it("handles exact segment boundaries and full reverse traversal", () => {
    const boundary = quoteSell(curve, 2n, 3n * Q64_ONE);
    const complete = quoteSell(curve, 3n, 3n * Q64_ONE);

    expect(boundary.outputAtomic).toBe(12n);
    expect(boundary.nextSqrtPriceQ64x64).toBe(2n * Q64_ONE);
    expect(boundary.unfilledInputAtomic).toBe(0n);
    expect(complete.outputAtomic).toBe(14n);
    expect(complete.nextSqrtPriceQ64x64).toBe(Q64_ONE);
  });

  it("matches the SDK for partial, cross-segment, and exhausted sells", () => {
    const sdkConfig = {
      curve: sdkCurve,
      sqrtStartPrice: sdkInteger(curve.startSqrtPriceQ64x64),
    } as unknown as Parameters<typeof calculateBaseToQuoteFromAmountIn>[0];
    const partial = quoteSell(curve, 1n, 3n * Q64_ONE);
    const sdkPartial = calculateBaseToQuoteFromAmountIn(
      sdkConfig,
      sdkInteger(3n * Q64_ONE),
      sdkInteger(1n),
    );
    const crossing = quoteSell(curve, 3n, 3n * Q64_ONE);
    const sdkCrossing = calculateBaseToQuoteFromAmountIn(
      sdkConfig,
      sdkInteger(3n * Q64_ONE),
      sdkInteger(3n),
    );
    const exhausted = quoteSell(curve, 4n, 3n * Q64_ONE);
    const sdkExhausted = calculateBaseToQuoteFromAmountIn(
      sdkConfig,
      sdkInteger(3n * Q64_ONE),
      sdkInteger(4n),
    );

    expect(partial.outputAtomic.toString()).toBe(sdkPartial.outputAmount.toString());
    expect(partial.nextSqrtPriceQ64x64.toString()).toBe(sdkPartial.nextSqrtPrice.toString());
    expect(crossing.outputAtomic.toString()).toBe(sdkCrossing.outputAmount.toString());
    expect(crossing.nextSqrtPriceQ64x64.toString()).toBe(sdkCrossing.nextSqrtPrice.toString());
    expect(exhausted.unfilledInputAtomic.toString()).toBe(sdkExhausted.amountLeft.toString());
    expect(exhausted.consumedInputAtomic).toBe(3n);
  });

  it("quotes from within a segment and leaves input unfilled at the start price", () => {
    const currentPrice = 2n * Q64_ONE + Q64_ONE / 2n;
    const local = quoteSell(curve, 1n, currentPrice);
    const sdkConfig = {
      curve: sdkCurve,
      sqrtStartPrice: sdkInteger(curve.startSqrtPriceQ64x64),
    } as unknown as Parameters<typeof calculateBaseToQuoteFromAmountIn>[0];
    const sdk = calculateBaseToQuoteFromAmountIn(
      sdkConfig,
      sdkInteger(currentPrice),
      sdkInteger(1n),
    );
    const atStart = quoteSell(curve, 1n, curve.startSqrtPriceQ64x64);

    expect(local.outputAtomic.toString()).toBe(sdk.outputAmount.toString());
    expect(local.nextSqrtPriceQ64x64.toString()).toBe(sdk.nextSqrtPrice.toString());
    expect(atStart.unfilledInputAtomic).toBe(1n);
    expect(atStart.outputAtomic).toBe(0n);
  });
});
