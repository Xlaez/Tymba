import type { Decimal } from "decimal.js";
import type { AssetAmount, AssetAmountPair, SimulationClock } from "./pool-state.js";
import type { DistributionSummary } from "./simulation.js";
import type { SeededRunMetadata } from "./seeded-random.js";

export type AttackScenario =
  | "opening-sniper"
  | "whale-entry"
  | "pump-and-dump"
  | "sell-cascade"
  | "fee-schedule-timing";

export type SeededAttackScenario = Exclude<AttackScenario, "fee-schedule-timing">;

export type AttackRunStatus = "completed" | "partial" | "failed";

export type AttackIterationOutcome = Readonly<
  SeededRunMetadata & {
    id: string;
    status: "completed" | "partial" | "failed";
    completedTicks: bigint;
    failure?: AttackFailure;
  }
>;

export type AttackRunMetadata = Readonly<{
  id: string;
  requestedIterations: bigint;
  completedIterations: bigint;
  partialIterations: bigint;
  failedIterations: bigint;
  iterationOutcomes: readonly AttackIterationOutcome[];
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds?: bigint;
}> &
  SeededRunMetadata;

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
  feesSaved: AssetAmountPair;
  pnlImprovementQuote: AssetAmount<"quote">;
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
export type FeeScheduleCandidateOutcome = Readonly<{
  candidateIndex: bigint;
  entryClock: SimulationClock;
  status: "completed" | "failed";
  feesPaid?: AssetAmountPair;
  pnlQuote?: AssetAmount<"quote">;
  failure?: AttackFailure;
}>;

export type FeeScheduleTimingRunMetadata = Readonly<{
  id: string;
  scenario: "fee-schedule-timing";
  status: "completed" | "partial" | "failed";
  candidateCount: bigint;
  completedCandidates: bigint;
  failedCandidates: bigint;
  candidateOutcomes: readonly FeeScheduleCandidateOutcome[];
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds: bigint;
}>;

export type FeeScheduleTimingResult = Readonly<
  FeeScheduleTimingRunMetadata & {
    status: "completed" | "partial";
    metrics: FeeScheduleTimingMetrics;
  }
>;

export type FailedFeeScheduleTimingResult = Readonly<
  FeeScheduleTimingRunMetadata & {
    status: "failed";
    failure: AttackFailure;
  }
>;

export type FailedAttackResult = Readonly<
  AttackRunMetadata & {
    scenario: SeededAttackScenario;
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
  | FailedAttackResult
  | FailedFeeScheduleTimingResult;
