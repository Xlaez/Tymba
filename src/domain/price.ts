import { Decimal } from "decimal.js";
import { MAX_CURVE_U128 } from "./curve.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const MAX_PRICE_LENGTH = 256;

export const Q64_ONE = 1n << 64n;
export const Q128_SCALE = 1n << 128n;

export function priceToSqrtPriceQ64x64(
  price: string,
  baseDecimals: number,
  quoteDecimals: number,
): bigint {
  validateAssetDecimals(baseDecimals, quoteDecimals);
  const { numerator: priceNumerator, denominator: priceDenominator } = parsePositiveDecimal(price);
  const decimalShift = quoteDecimals - baseDecimals;
  const numerator =
    decimalShift >= 0 ? priceNumerator * 10n ** BigInt(decimalShift) : priceNumerator;
  const denominator =
    decimalShift < 0 ? priceDenominator * 10n ** BigInt(-decimalShift) : priceDenominator;
  const sqrtPriceQ64x64 = integerSquareRoot((numerator << 128n) / denominator);

  if (sqrtPriceQ64x64 <= 0n || sqrtPriceQ64x64 > MAX_CURVE_U128) {
    throw new RangeError("Encoded sqrt price must be a positive u128 value");
  }

  return sqrtPriceQ64x64;
}

export function sqrtPriceQ64x64ToPrice(
  sqrtPriceQ64x64: bigint,
  baseDecimals: number,
  quoteDecimals: number,
): Decimal {
  validateAssetDecimals(baseDecimals, quoteDecimals);
  if (
    typeof sqrtPriceQ64x64 !== "bigint" ||
    sqrtPriceQ64x64 <= 0n ||
    sqrtPriceQ64x64 > MAX_CURVE_U128
  ) {
    throw new RangeError("Encoded sqrt price must be a positive u128 bigint");
  }

  const decimalShift = baseDecimals - quoteDecimals;
  const numerator =
    sqrtPriceQ64x64 * sqrtPriceQ64x64 * (decimalShift >= 0 ? 10n ** BigInt(decimalShift) : 1n);
  const denominator = Q128_SCALE * (decimalShift < 0 ? 10n ** BigInt(-decimalShift) : 1n);

  return new ExactDecimal(numerator.toString()).div(denominator.toString());
}

function parsePositiveDecimal(value: string): Readonly<{ numerator: bigint; denominator: bigint }> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PRICE_LENGTH ||
    !/^\d+(?:\.\d+)?$/.test(value)
  ) {
    throw new TypeError(
      `Price must be a plain positive decimal string up to ${MAX_PRICE_LENGTH} characters`,
    );
  }

  const [whole, fraction = ""] = value.split(".");
  if (whole === undefined) throw new TypeError("Price must include an integer part");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= 0n) throw new RangeError("Price must be greater than zero");

  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function validateAssetDecimals(baseDecimals: number, quoteDecimals: number): void {
  if (!Number.isInteger(baseDecimals) || baseDecimals < 6 || baseDecimals > 9) {
    throw new RangeError("Base decimals must be an integer from 6 to 9");
  }
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 255) {
    throw new RangeError("Quote decimals must be an integer from 0 to 255");
  }
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n) throw new RangeError("Square root input must not be negative");
  if (value < 2n) return value;

  const bitLength = value.toString(2).length;
  let estimate = 1n << BigInt((bitLength + 1) >> 1);

  while (true) {
    const next = (estimate + value / estimate) >> 1n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}
