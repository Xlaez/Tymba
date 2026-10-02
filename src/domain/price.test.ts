import { getSqrtPriceFromPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { describe, expect, it } from "vitest";
import { MAX_CURVE_U128 } from "./curve.js";
import { priceToSqrtPriceQ64x64, Q64_ONE, Q128_SCALE, sqrtPriceQ64x64ToPrice } from "./price.js";

describe("price and Q64.64 conversion", () => {
  it("matches the pinned SDK encoding for the 9/6 demo prices", () => {
    for (const price of ["0.0002", "0.002"]) {
      const encoded = priceToSqrtPriceQ64x64(price, 9, 6);

      expect(encoded.toString()).toBe(getSqrtPriceFromPrice(price, 9, 6).toString());
    }
  });

  it("accounts for either direction of the base and quote decimal scale", () => {
    expect(priceToSqrtPriceQ64x64("1", 9, 6)).toBe(583_337_266_871_351_588n);
    expect(priceToSqrtPriceQ64x64("1", 6, 9)).toBe(583_337_266_871_351_588_485n);
  });

  it("decodes and re-encodes exact Q64.64 boundaries", () => {
    const encoded = 2n * Q64_ONE;
    const price = sqrtPriceQ64x64ToPrice(encoded, 9, 9);

    expect(Q128_SCALE).toBe(Q64_ONE * Q64_ONE);
    expect(price.toString()).toBe("4");
    expect(priceToSqrtPriceQ64x64(price.toString(), 9, 9)).toBe(encoded);
  });

  it("keeps quantization below the input price and the next unit above it", () => {
    const priceText = "0.0002";
    const encoded = priceToSqrtPriceQ64x64(priceText, 9, 6);
    const decoded = sqrtPriceQ64x64ToPrice(encoded, 9, 6);
    const nextDecoded = sqrtPriceQ64x64ToPrice(encoded + 1n, 9, 6);

    expect(decoded.lte(priceText)).toBe(true);
    expect(nextDecoded.gt(priceText)).toBe(true);
  });

  it("surfaces precision divergence in the pinned SDK convenience helper", () => {
    const exact = priceToSqrtPriceQ64x64("1", 6, 9);
    const sdk = BigInt(getSqrtPriceFromPrice("1", 6, 9).toString());
    const largeExact = priceToSqrtPriceQ64x64("100000000", 6, 9);
    const largeSdk = BigInt(getSqrtPriceFromPrice("100000000", 6, 9).toString());

    expect(exact - sdk).toBe(-5n);
    expect(largeExact - largeSdk).toBe(-42_054n);
  });

  it("rejects non-positive, malformed, under-resolved, and out-of-u128 prices", () => {
    expect(() => priceToSqrtPriceQ64x64("0", 9, 6)).toThrow(RangeError);
    expect(() => priceToSqrtPriceQ64x64("-1", 9, 6)).toThrow(TypeError);
    expect(() => priceToSqrtPriceQ64x64("1e-8", 9, 6)).toThrow(TypeError);
    expect(() => priceToSqrtPriceQ64x64(`0.${"0".repeat(40)}1`, 9, 6)).toThrow(RangeError);
    expect(() => priceToSqrtPriceQ64x64(`1${"0".repeat(40)}`, 6, 9)).toThrow(RangeError);
    expect(() => sqrtPriceQ64x64ToPrice(0n, 9, 6)).toThrow(RangeError);
    expect(() => sqrtPriceQ64x64ToPrice(MAX_CURVE_U128 + 1n, 9, 6)).toThrow(RangeError);
  });

  it("rejects asset decimal metadata outside the domain contract", () => {
    expect(() => priceToSqrtPriceQ64x64("1", 5, 6)).toThrow(RangeError);
    expect(() => priceToSqrtPriceQ64x64("1", 9, 256)).toThrow(RangeError);
    expect(sqrtPriceQ64x64ToPrice(Q64_ONE, 9, 9).toString()).toBe("1");
  });
});
