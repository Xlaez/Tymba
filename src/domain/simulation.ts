import type { Decimal } from "decimal.js";
import type { AssetAmount, AssetAmountPair, PoolState } from "./pool-state.js";
import type { VerificationStatus } from "./status.js";
import type { TradeResult } from "./trade-result.js";
import type { PostMigrationLiquidityAllocation } from "./migration-allocation.js";
import type { SeededRunMetadata } from "./seeded-random.js";

export type SimulationKind = "deterministic" | "stochastic";

export type SimulationRunStatus = "completed" | "partial" | "failed";

export type AgentArchetype =
  | "retail-buyer"
  | "whale"
  | "sniper"
  | "momentum-trader"
  | "profit-taker"
  | "panic-seller"
  | "random-trader";

export type DistributionSummary<Value> = Readonly<{
  p05: Value;
  median: Value;
  p95: Value;
}>;

export type SimulationUncertaintyLabel = "insufficient-data" | "low" | "moderate" | "high";

export type SimulationUncertaintyReason =
  | "fewer-than-30-completed-runs"
  | "partial-or-failed-runs"
  | "wide-outcome-spread";

export type SimulationUncertainty = Readonly<{
  label: SimulationUncertaintyLabel;
  reasons: readonly SimulationUncertaintyReason[];
  requestedSampleSize: bigint;
  completedSampleSize: bigint;
  completionRateBps: bigint;
  relativeSpreadBps?: bigint;
}>;

export type SimulationRunMetadata = Readonly<{
  id: string;
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds?: bigint;
}>;

export type SimulationFailure = Readonly<{
  code: string;
  message: string;
}>;

export type DeterministicSimulationMetrics = Readonly<{
  migrated: boolean;
  finalSpotPrice: Decimal;
  finalMigrationPrice?: Decimal;
  finalMigrationFdv?: Decimal;
  quoteAccumulated: AssetAmount<"quote">;
  baseDistributed: AssetAmount<"base">;
  baseDistributedBps: bigint;
  maximumPriceImpactBps: bigint;
  maximumDrawdownBps: bigint;
  feesGenerated: AssetAmountPair;
  migrationFees: Readonly<{
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  }>;
  surplus: Readonly<{
    protocol: AssetAmount<"quote">;
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  }>;
  liquidityAllocation?: PostMigrationLiquidityAllocation;
}>;

export type DeterministicSimulationResult = Readonly<
  SimulationRunMetadata & {
    kind: "deterministic";
    status: "completed" | "partial";
    initialState: PoolState;
    finalState: PoolState;
    trades: readonly TradeResult[];
    metrics: DeterministicSimulationMetrics;
    verificationStatus: VerificationStatus;
  }
>;

export type AgentCounts = Readonly<Record<AgentArchetype, bigint>>;

export type StochasticSimulationSummary = Readonly<{
  graduationFrequencyBps: bigint;
  quoteAccumulated: DistributionSummary<AssetAmount<"quote">>;
  baseDistributed: DistributionSummary<AssetAmount<"base">>;
  timeToMigrationSeconds?: DistributionSummary<bigint>;
  maximumDrawdownBps: DistributionSummary<bigint>;
  maximumPriceImpactBps: DistributionSummary<bigint>;
  topHolderConcentrationBps?: DistributionSummary<bigint>;
  topTenHolderConcentrationBps?: DistributionSummary<bigint>;
  feesGenerated: DistributionSummary<AssetAmountPair>;
  creatorFees?: DistributionSummary<AssetAmountPair>;
  sniperExtractionQuote?: DistributionSummary<AssetAmount<"quote">>;
}>;

export type StochasticIterationOutcome = Readonly<
  SeededRunMetadata & {
    id: string;
    status: "completed" | "partial" | "failed";
    completedTicks: bigint;
    failure?: SimulationFailure;
  }
>;

export type StochasticSimulationResult = Readonly<
  SimulationRunMetadata &
    SeededRunMetadata & {
      kind: "stochastic";
      status: "completed" | "partial";
      requestedIterations: bigint;
      completedIterations: bigint;
      partialIterations: bigint;
      failedIterations: bigint;
      agentCounts: AgentCounts;
      iterationOutcomes: readonly StochasticIterationOutcome[];
      uncertainty: SimulationUncertainty;
      summary: StochasticSimulationSummary;
    }
>;

export type FailedStochasticSimulationResult = Readonly<
  SimulationRunMetadata &
    SeededRunMetadata & {
      kind: "stochastic";
      status: "failed";
      requestedIterations: bigint;
      completedIterations: 0n;
      partialIterations: bigint;
      failedIterations: bigint;
      iterationOutcomes: readonly StochasticIterationOutcome[];
      uncertainty: SimulationUncertainty;
      failure: SimulationFailure;
    }
>;

export type FailedDeterministicSimulationResult = Readonly<
  SimulationRunMetadata & {
    kind: "deterministic";
    status: "failed";
    failure: SimulationFailure;
  }
>;

export type FailedSimulationResult =
  | FailedDeterministicSimulationResult
  | FailedStochasticSimulationResult;

export type SimulationResult =
  | DeterministicSimulationResult
  | StochasticSimulationResult
  | FailedSimulationResult;
