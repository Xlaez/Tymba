export type FeeClock = "slot" | "timestamp";

export type FeeCollectionMode = "quote" | "output";

export type FixedBaseFeeSchedule = Readonly<{
  kind: "fixed";
  feeBps: bigint;
}>;

export type ScheduledBaseFee = Readonly<{
  kind: "linear" | "exponential";
  startingFeeBps: bigint;
  endingFeeBps: bigint;
  periodCount: bigint;
  periodFrequency: bigint;
  clock: FeeClock;
}>;

export type BaseFeeSchedule = FixedBaseFeeSchedule | ScheduledBaseFee;

export type DynamicFeeConfiguration = Readonly<{
  binStepBps: bigint;
  filterPeriodSeconds: bigint;
  decayPeriodSeconds: bigint;
  reductionFactorBps: bigint;
  maxVolatilityAccumulator: bigint;
  variableFeeControl: bigint;
}>;

export type MigratedPoolFeeConfiguration = Readonly<{
  feeBps: bigint;
  collectFeeMode: "quote" | "output" | "compounding";
  dynamicFeeEnabled: boolean;
  compoundingFeeBps?: bigint;
}>;

export type FeeConfiguration = Readonly<{
  base: BaseFeeSchedule;
  dynamic?: DynamicFeeConfiguration;
  collectFeeMode: FeeCollectionMode;
  creatorTradingFeeShareBps: bigint;
  migratedPool?: MigratedPoolFeeConfiguration;
}>;
