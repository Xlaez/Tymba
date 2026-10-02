import type { CurrencyAmount } from "./currency-amount.js";
import type { DbcCurve } from "./curve.js";
import type { FeeClock, FeeConfiguration } from "./fees.js";
import type { MigrationConfiguration, MigrationProgress } from "./migration.js";

export type AssetAmountPair = Readonly<{
  base: CurrencyAmount;
  quote: CurrencyAmount;
}>;

export type PoolSupplyState = Readonly<{
  mode: "dynamic" | "fixed";
  totalBaseSupply: AssetAmount<"base">;
  baseDistributed: AssetAmount<"base">;
}>;

export type EconomicLedger = Readonly<{
  pool: AssetAmountPair;
  fees: Readonly<{
    totalTrading: AssetAmountPair;
    protocol: AssetAmountPair;
    partner: AssetAmountPair;
    creator: AssetAmountPair;
    referral: AssetAmountPair;
  }>;
  surplus: Readonly<{
    protocol: AssetAmount<"quote">;
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  }>;
  migration: Readonly<{
    partnerFee: AssetAmount<"quote">;
    creatorFee: AssetAmount<"quote">;
    protocolLiquidityFee: AssetAmountPair;
    dammLiquidity: AssetAmountPair;
  }>;
  leftoverBase: AssetAmount<"base">;
}>;

export type SimulationClock = Readonly<{
  slot: bigint;
  timestampSeconds: bigint;
}>;

export type DynamicFeeState = Readonly<{
  lastUpdateTimestamp: bigint;
  sqrtPriceReferenceQ64x64: bigint;
  volatilityAccumulator: bigint;
  volatilityReference: bigint;
}>;

export type PoolState = Readonly<{
  curve: DbcCurve;
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  supply: PoolSupplyState;
  ledger: EconomicLedger;
  currentSqrtPriceQ64x64: bigint;
  clock: SimulationClock;
  activationPoint: bigint;
  activationType: FeeClock;
  migrationProgress: MigrationProgress;
  hasSwapped: boolean;
  dynamicFeeState?: DynamicFeeState;
}>;

export type AssetSide = "base" | "quote";

export type AssetAmount<Asset extends AssetSide = AssetSide> = Readonly<{
  asset: Asset;
  amount: CurrencyAmount;
}>;
