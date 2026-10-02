import { describe, expect, it } from "vitest";
import {
  currencyAmount,
  formatCurrencyAmount,
  parseCurrencyAmount,
  rescaleCurrencyAmount,
} from "./currency-amount.js";

describe("CurrencyAmount", () => {
  it("parses decimal strings exactly for six-decimal quote assets", () => {
    expect(parseCurrencyAmount("123.450006", 6)).toEqual({ raw: 123_450_006n, decimals: 6 });
  });

  it("parses signed and zero-decimal amounts", () => {
    expect(parseCurrencyAmount("-0.25", 2)).toEqual({ raw: -25n, decimals: 2 });
    expect(parseCurrencyAmount("+42", 0)).toEqual({ raw: 42n, decimals: 0 });
  });

  it("rejects malformed input and excess fractional precision", () => {
    for (const value of ["", " 1", "1 ", "1e3", "1,000", ".5", "1."]) {
      expect(() => parseCurrencyAmount(value, 6)).toThrow();
    }
    expect(() => parseCurrencyAmount("1.0000001", 6)).toThrow(RangeError);
  });

  it("validates decimal metadata against the mint field range", () => {
    expect(currencyAmount(1n, 255)).toEqual({ raw: 1n, decimals: 255 });
    for (const decimals of [-1, 256, 1.5, Number.NaN]) {
      expect(() => currencyAmount(1n, decimals)).toThrow(RangeError);
    }
  });

  it("formats without floating-point conversion and can preserve declared precision", () => {
    expect(formatCurrencyAmount(currencyAmount(1_234_500n, 6))).toBe("1.2345");
    expect(formatCurrencyAmount(currencyAmount(1_234_500n, 6), { trimTrailingZeros: false })).toBe(
      "1.234500",
    );
    expect(formatCurrencyAmount(currencyAmount(-5n, 2))).toBe("-0.05");
    expect(formatCurrencyAmount(currencyAmount(42n, 0))).toBe("42");
  });

  it("rescales upward exactly and rejects implicit precision loss", () => {
    expect(rescaleCurrencyAmount(currencyAmount(123n, 2), 6)).toEqual({
      raw: 1_230_000n,
      decimals: 6,
    });
    expect(() => rescaleCurrencyAmount(currencyAmount(123_456n, 6), 2)).toThrow(RangeError);
  });

  it("supports explicit truncation, floor, and ceiling for signed values", () => {
    const positive = currencyAmount(123_456n, 6);
    const negative = currencyAmount(-123_456n, 6);

    expect(rescaleCurrencyAmount(positive, 2, "trunc").raw).toBe(12n);
    expect(rescaleCurrencyAmount(positive, 2, "floor").raw).toBe(12n);
    expect(rescaleCurrencyAmount(positive, 2, "ceil").raw).toBe(13n);
    expect(rescaleCurrencyAmount(negative, 2, "trunc").raw).toBe(-12n);
    expect(rescaleCurrencyAmount(negative, 2, "floor").raw).toBe(-13n);
    expect(rescaleCurrencyAmount(negative, 2, "ceil").raw).toBe(-12n);
  });
});
