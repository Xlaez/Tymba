import type { DbcCurve } from "../domain/curve.js";
import type { NormalizedMarketIntent } from "../domain/market-intent.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";
import { jsonSnapshot } from "./attack.js";
import type { WebAdvancedParameters } from "./contracts.js";

export function presentAdvanced(
  candidateId: string,
  curve: DbcCurve,
  market: NormalizedMarketIntent,
  settings: unknown,
): WebAdvancedParameters {
  return {
    candidateId,
    baseDecimals: curve.baseDecimals,
    quoteDecimals: curve.quoteDecimals,
    totalBaseAtomic: market.totalBaseAtomic.toString(),
    startSqrtPriceQ64x64: curve.startSqrtPriceQ64x64.toString(),
    migrationQuoteThresholdAtomic: curve.migrationQuoteThresholdAtomic.toString(),
    segments: curve.segments.map((segment) => ({
      lowerSqrtPriceQ64x64: segment.lowerSqrtPriceQ64x64.toString(),
      upperSqrtPriceQ64x64: segment.upperSqrtPriceQ64x64.toString(),
      liquidity: segment.liquidity.toString(),
    })),
    settings: jsonSnapshot(settings),
    sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
  };
}
