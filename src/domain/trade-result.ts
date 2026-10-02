import type { Decimal } from "decimal.js";
import type { AssetAmount, AssetAmountPair, AssetSide } from "./pool-state.js";

export type TradeFillStatus = "filled" | "partial";

export type TradeFeeAmounts = Readonly<{
  tradingFee: AssetAmount;
  protocolFee: AssetAmount;
  referralFee: AssetAmount;
}>;

export type TradeMetrics = Readonly<{
  spotPriceBefore: Decimal;
  spotPriceAfter: Decimal;
  priceImpactBps: bigint;
  migrationProgressBeforeBps: bigint;
  migrationProgressAfterBps: bigint;
  poolReservesAfter: AssetAmountPair;
}>;

export type TradeResultBase<
  InputAsset extends AssetSide = AssetSide,
  OutputAsset extends AssetSide = AssetSide,
> = Readonly<{
  status: TradeFillStatus;
  requestedInput: AssetAmount<InputAsset>;
  consumedInput: AssetAmount<InputAsset>;
  unfilledInput: AssetAmount<InputAsset>;
  output: AssetAmount<OutputAsset>;
  nextSqrtPriceQ64x64: bigint;
  fees: TradeFeeAmounts;
  metrics: TradeMetrics;
}>;

export type BuyResult = Readonly<
  TradeResultBase<"quote", "base"> & {
    direction: "buy";
  }
>;

export type SellResult = Readonly<
  TradeResultBase<"base", "quote"> & {
    direction: "sell";
  }
>;

export type TradeResult = BuyResult | SellResult;
