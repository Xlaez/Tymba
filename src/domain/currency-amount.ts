export type CurrencyAmount = Readonly<{
  raw: bigint;
  decimals: number;
}>;

export type AmountRounding = "reject" | "floor" | "ceil" | "trunc";

export const MAX_CURRENCY_DECIMALS = 255;

export function currencyAmount(raw: bigint, decimals: number): CurrencyAmount {
  if (typeof raw !== "bigint") {
    throw new TypeError("CurrencyAmount.raw must be a bigint");
  }

  validateDecimals(decimals);
  return { raw, decimals };
}

export function parseCurrencyAmount(value: string, decimals: number): CurrencyAmount {
  validateDecimals(decimals);

  if (typeof value !== "string") {
    throw new TypeError("Currency amount input must be a string");
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new TypeError("Currency amount must be a plain decimal string");
  }

  const sign = match[1] ?? "";
  const whole = match[2];
  const fraction = match[3] ?? "";
  if (whole === undefined) {
    throw new TypeError("Currency amount must include an integer part");
  }
  if (fraction.length > decimals) {
    throw new RangeError(`Currency amount has more than ${decimals} fractional digits`);
  }

  const scale = 10n ** BigInt(decimals);
  const fractionalUnits = fraction.length === 0 ? 0n : BigInt(fraction.padEnd(decimals, "0"));
  const magnitude = BigInt(whole) * scale + fractionalUnits;
  return currencyAmount(sign === "-" ? -magnitude : magnitude, decimals);
}

export function formatCurrencyAmount(
  amount: CurrencyAmount,
  options: Readonly<{ trimTrailingZeros?: boolean }> = {},
): string {
  validateAmount(amount);

  const negative = amount.raw < 0n;
  const magnitude = negative ? -amount.raw : amount.raw;
  if (amount.decimals === 0) {
    return `${negative ? "-" : ""}${magnitude}`;
  }

  const scale = 10n ** BigInt(amount.decimals);
  const whole = magnitude / scale;
  let fraction = (magnitude % scale).toString().padStart(amount.decimals, "0");
  if (options.trimTrailingZeros ?? true) {
    fraction = fraction.replace(/0+$/, "");
  }

  const sign = negative ? "-" : "";
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function rescaleCurrencyAmount(
  amount: CurrencyAmount,
  decimals: number,
  rounding: AmountRounding = "reject",
): CurrencyAmount {
  validateAmount(amount);
  validateDecimals(decimals);

  const decimalDelta = decimals - amount.decimals;
  if (decimalDelta === 0) {
    return currencyAmount(amount.raw, decimals);
  }
  if (decimalDelta > 0) {
    return currencyAmount(amount.raw * 10n ** BigInt(decimalDelta), decimals);
  }

  const divisor = 10n ** BigInt(-decimalDelta);
  const quotient = amount.raw / divisor;
  const remainder = amount.raw % divisor;
  if (remainder === 0n) {
    return currencyAmount(quotient, decimals);
  }

  switch (rounding) {
    case "reject":
      throw new RangeError("Rescaling would discard non-zero fractional units");
    case "trunc":
      return currencyAmount(quotient, decimals);
    case "floor":
      return currencyAmount(amount.raw < 0n ? quotient - 1n : quotient, decimals);
    case "ceil":
      return currencyAmount(amount.raw > 0n ? quotient + 1n : quotient, decimals);
    default:
      return assertNever(rounding);
  }
}

function validateAmount(amount: CurrencyAmount): void {
  if (typeof amount !== "object" || amount === null || typeof amount.raw !== "bigint") {
    throw new TypeError("Currency amount must contain a bigint raw value");
  }
  validateDecimals(amount.decimals);
}

function validateDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_CURRENCY_DECIMALS) {
    throw new RangeError(`Currency decimals must be an integer from 0 to ${MAX_CURRENCY_DECIMALS}`);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported amount rounding mode: ${String(value)}`);
}
