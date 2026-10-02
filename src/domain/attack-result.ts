import type { Decimal } from "decimal.js";
import type { AssetAmount, AssetAmountPair, SimulationClock } from "./pool-state.js";
import type { DistributionSummary } from "./simulation.js";

export type AttackScenario =
  | "opening-sniper"
  | "whale-entry"
  | "pump-and-dump"
  | "sell-cascade"
  | "fee-schedule-timing";

export type AttackRunStatus = "completed" | "partial" | "failed";

export type AttackRunMetadata = Readonly<{
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  completedIterations: bigint;
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds?: bigint;
}>;

export type AttackFailure = Readonly<{
  code: string;
  message: string;
}>;

export type OpeningSniperMetrics = Readonly<{
  attackerPnlQuote: DistributionSummary<AssetAmount<"quote">>;
  lateBuyerPriceDisadvantageBps: DistributionSummary<bigint>;
  drawdownAfterExitBps: DistributionSummary<bigint>;
  feesPaid: DistributionSummary<AssetAmountPair>;
}>;

export type WhaleEntryMetrics = Readonly<{
  priceDisplacementBps: DistributionSummary<bigint>;
  baseAcquired: DistributionSummary<AssetAmount<"base">>;
  averageExecutionPrice: DistributionSummary<Decimal>;
  postBuyConcentrationBps: DistributionSummary<bigint>;
}>;

export type PumpAndDumpMetrics = Readonly<{
  attackerPnlQuote: DistributionSummary<AssetAmount<"quote">>;
  peakToTroughDrawdownBps: DistributionSummary<bigint>;
  lateBuyerLossBps: DistributionSummary<bigint>;
  recoveryQuoteRequired: DistributionSummary<AssetAmount<"quote">>;
  feesPaid: DistributionSummary<AssetAmountPair>;
}>;

export type SellCascadeMetrics = Readonly<{
  maximumDrawdownBps: DistributionSummary<bigint>;
  quoteOutflow: DistributionSummary<AssetAmount<"quote">>;
  recoveryQuoteRequired: DistributionSummary<AssetAmount<"quote">>;
  migrationDelaySeconds: DistributionSummary<bigint>;
}>;

export type FeeScheduleTimingMetrics = Readonly<{
  bestEntryClock: SimulationClock;
  feesSaved: DistributionSummary<AssetAmount>;
  pnlImprovementQuote: DistributionSummary<AssetAmount<"quote">>;
}>;

export type CompletedAttackResult<Scenario extends AttackScenario, Metrics> = Readonly<
  AttackRunMetadata & {
    scenario: Scenario;
    status: "completed" | "partial";
    metrics: Metrics;
  }
>;

export type OpeningSniperResult = CompletedAttackResult<"opening-sniper", OpeningSniperMetrics>;
export type WhaleEntryResult = CompletedAttackResult<"whale-entry", WhaleEntryMetrics>;
export type PumpAndDumpResult = CompletedAttackResult<"pump-and-dump", PumpAndDumpMetrics>;
export type SellCascadeResult = CompletedAttackResult<"sell-cascade", SellCascadeMetrics>;
export type FeeScheduleTimingResult = CompletedAttackResult<
  "fee-schedule-timing",
  FeeScheduleTimingMetrics
>;

export type FailedAttackResult = Readonly<
  AttackRunMetadata & {
    scenario: AttackScenario;
    status: "failed";
    failure: AttackFailure;
  }
>;

export type AttackResult =
  | OpeningSniperResult
  | WhaleEntryResult
  | PumpAndDumpResult
  | SellCascadeResult
  | FeeScheduleTimingResult
  | FailedAttackResult;
