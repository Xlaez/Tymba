import type { Decimal } from "decimal.js";
import type { AssetAmount, AssetAmountPair, PoolState } from "./pool-state.js";
import type { VerificationStatus } from "./status.js";
import type { TradeResult } from "./trade-result.js";

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
  median: Value;
  p95?: Value;
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
  topHolderConcentrationBps?: DistributionSummary<bigint>;
  topTenHolderConcentrationBps?: DistributionSummary<bigint>;
  creatorFees?: DistributionSummary<AssetAmountPair>;
  sniperExtractionQuote?: DistributionSummary<AssetAmount<"quote">>;
}>;

export type StochasticSimulationResult = Readonly<
  SimulationRunMetadata & {
    kind: "stochastic";
    status: "completed" | "partial";
    randomSeed: bigint;
    requestedIterations: bigint;
    completedIterations: bigint;
    agentCounts: AgentCounts;
    summary: StochasticSimulationSummary;
  }
>;

export type FailedSimulationResult = Readonly<
  SimulationRunMetadata & {
    kind: SimulationKind;
    status: "failed";
    failure: SimulationFailure;
  }
>;

export type SimulationResult =
  | DeterministicSimulationResult
  | StochasticSimulationResult
  | FailedSimulationResult;
