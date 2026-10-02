import type { Decimal } from "decimal.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type { PoolState } from "../pool-state.js";
import type { BuyResult } from "../trade-result.js";
import { getSpotPrice, quoteBuy } from "../simulator.js";

export function quoteRequiredForPrice(state: PoolState, targetPrice: Decimal): bigint | undefined {
  if (getSpotPrice(state).greaterThanOrEqualTo(targetPrice)) return 0n;
  if (state.migrationProgress !== "bonding") return undefined;
  let low = 1n;
  let high = MAX_CURVE_U64;
  let maximumQuote: BuyResult;
  try {
    maximumQuote = quoteBuy(high, state);
  } catch {
    return undefined;
  }
  if (maximumQuote.metrics.spotPriceAfter.lessThan(targetPrice)) return undefined;
  while (low < high) {
    const middle = (low + high) / 2n;
    const quote = quoteBuy(middle, state);
    if (quote.metrics.spotPriceAfter.greaterThanOrEqualTo(targetPrice)) high = middle;
    else low = middle + 1n;
  }
  return quoteBuy(low, state).consumedInput.amount.raw;
}
