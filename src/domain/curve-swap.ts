import type { CurveSegment, DbcCurve } from "./curve.js";
import { MAX_CURVE_U64, validateDbcCurveShape } from "./curve.js";
import {
  baseDistributedForSegment,
  baseRequiredForSegment,
  quoteDistributedForSegment,
  quoteRequiredForSegment,
  sqrtPriceAfterBaseInput,
  sqrtPriceAfterQuoteInput,
} from "./segment-math.js";

export type CurveSwapQuote = Readonly<{
  requestedInputAtomic: bigint;
  consumedInputAtomic: bigint;
  unfilledInputAtomic: bigint;
  outputAtomic: bigint;
  nextSqrtPriceQ64x64: bigint;
}>;

export function quoteBuy(
  curveInput: DbcCurve,
  quoteInputAtomic: bigint,
  currentSqrtPriceQ64x64: bigint = curveInput.startSqrtPriceQ64x64,
  stopSqrtPriceQ64x64?: bigint,
): CurveSwapQuote {
  const curve = requireCurve(curveInput);
  validateAmount(quoteInputAtomic);
  validateCurrentPrice(curve, currentSqrtPriceQ64x64);
  const stopPrice =
    stopSqrtPriceQ64x64 ?? curve.segments[curve.segments.length - 1]?.upperSqrtPriceQ64x64;
  validateStopPrice(curve, currentSqrtPriceQ64x64, stopPrice);

  let amountLeft = quoteInputAtomic;
  let outputAtomic = 0n;
  let currentPrice = currentSqrtPriceQ64x64;

  for (const segment of curve.segments) {
    if (amountLeft === 0n) break;
    const segmentUpperPrice =
      stopPrice !== undefined && stopPrice < segment.upperSqrtPriceQ64x64
        ? stopPrice
        : segment.upperSqrtPriceQ64x64;
    if (currentPrice >= segmentUpperPrice) {
      if (currentPrice === stopPrice) break;
      continue;
    }
    if (currentPrice < segment.lowerSqrtPriceQ64x64) {
      throw new RangeError("Current sqrt price does not lie on the configured curve");
    }

    const activeSegment = clippedSegment(segment, currentPrice, segmentUpperPrice);
    const requiredQuote = quoteRequiredForSegment(activeSegment);
    if (amountLeft < requiredQuote) {
      const nextPrice = sqrtPriceAfterQuoteInput(currentPrice, segment.liquidity, amountLeft);
      if (nextPrice > currentPrice) {
        outputAtomic += baseDistributedForSegment(clippedSegment(segment, currentPrice, nextPrice));
      }
      currentPrice = nextPrice;
      amountLeft = 0n;
      break;
    }

    outputAtomic += baseDistributedForSegment(activeSegment);
    currentPrice = segmentUpperPrice;
    amountLeft -= requiredQuote;
    if (currentPrice === stopPrice) break;
  }

  return makeQuote(quoteInputAtomic, amountLeft, outputAtomic, currentPrice);
}

function validateStopPrice(
  curve: DbcCurve,
  currentPrice: bigint,
  stopPrice: bigint | undefined,
): void {
  const lastSegment = curve.segments[curve.segments.length - 1];
  if (
    stopPrice === undefined ||
    stopPrice < currentPrice ||
    stopPrice < curve.startSqrtPriceQ64x64 ||
    !lastSegment ||
    stopPrice > lastSegment.upperSqrtPriceQ64x64
  ) {
    throw new RangeError("Buy stop sqrt price must be within the remaining configured curve");
  }
}

export function quoteSell(
  curveInput: DbcCurve,
  baseInputAtomic: bigint,
  currentSqrtPriceQ64x64: bigint,
): CurveSwapQuote {
  const curve = requireCurve(curveInput);
  validateAmount(baseInputAtomic);
  validateCurrentPrice(curve, currentSqrtPriceQ64x64);

  let amountLeft = baseInputAtomic;
  let outputAtomic = 0n;
  let currentPrice = currentSqrtPriceQ64x64;

  for (let index = curve.segments.length - 1; index >= 0; index -= 1) {
    const segment = curve.segments[index];
    if (!segment || amountLeft === 0n || currentPrice <= segment.lowerSqrtPriceQ64x64) continue;

    const upperPrice =
      currentPrice < segment.upperSqrtPriceQ64x64 ? currentPrice : segment.upperSqrtPriceQ64x64;
    const activeSegment = clippedSegment(segment, segment.lowerSqrtPriceQ64x64, upperPrice);
    const requiredBase = baseRequiredForSegment(activeSegment);
    if (amountLeft < requiredBase) {
      const nextPrice = sqrtPriceAfterBaseInput(currentPrice, segment.liquidity, amountLeft);
      if (nextPrice < currentPrice) {
        outputAtomic += quoteDistributedForSegment(
          clippedSegment(segment, nextPrice, currentPrice),
        );
      }
      currentPrice = nextPrice;
      amountLeft = 0n;
      break;
    }

    outputAtomic += quoteDistributedForSegment(activeSegment);
    currentPrice = segment.lowerSqrtPriceQ64x64;
    amountLeft -= requiredBase;
  }

  return makeQuote(baseInputAtomic, amountLeft, outputAtomic, currentPrice);
}

function requireCurve(input: DbcCurve): DbcCurve {
  const result = validateDbcCurveShape(input);
  if (result.status === "invalid") {
    throw new RangeError(
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  return result.curve;
}

function validateAmount(amount: bigint): void {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_CURVE_U64) {
    throw new RangeError("Swap input must be a non-negative u64 bigint");
  }
}

function validateCurrentPrice(curve: DbcCurve, price: bigint): void {
  const lastSegment = curve.segments[curve.segments.length - 1];
  if (
    typeof price !== "bigint" ||
    price < curve.startSqrtPriceQ64x64 ||
    !lastSegment ||
    price > lastSegment.upperSqrtPriceQ64x64
  ) {
    throw new RangeError("Current sqrt price must be within the configured curve");
  }
}

function clippedSegment(
  segment: CurveSegment,
  lowerSqrtPriceQ64x64: bigint,
  upperSqrtPriceQ64x64: bigint,
): CurveSegment {
  return { lowerSqrtPriceQ64x64, upperSqrtPriceQ64x64, liquidity: segment.liquidity };
}

function makeQuote(
  requestedInputAtomic: bigint,
  unfilledInputAtomic: bigint,
  outputAtomic: bigint,
  nextSqrtPriceQ64x64: bigint,
): CurveSwapQuote {
  return {
    requestedInputAtomic,
    consumedInputAtomic: requestedInputAtomic - unfilledInputAtomic,
    unfilledInputAtomic,
    outputAtomic,
    nextSqrtPriceQ64x64,
  };
}
