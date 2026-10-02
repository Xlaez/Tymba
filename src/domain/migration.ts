import type { MigratedPoolFeeConfiguration } from "./fees.js";

export type MigrationDestination = "damm-v2";

export type MigrationProgress = "bonding" | "curve-complete" | "locked-vesting" | "migrated";

export type MigrationFeeConfiguration = Readonly<{
  feeBps: bigint;
  creatorFeeShareBps: bigint;
}>;

export type MigrationAllocationIntent = Readonly<{
  creatorLockedBps: bigint;
  partnerLockedBps: bigint;
  unlockedBps: bigint;
  lockDurationSeconds?: bigint;
}>;

export type LiquidityAllocationShare = Readonly<{
  unlockedBps: bigint;
  permanentlyLockedBps: bigint;
  vestingBps: bigint;
}>;

export type LiquidityAllocation = Readonly<{
  creator: LiquidityAllocationShare;
  partner: LiquidityAllocationShare;
}>;

export type MigrationConfiguration = Readonly<{
  destination: MigrationDestination;
  fee?: MigrationFeeConfiguration;
  allocationIntent?: MigrationAllocationIntent;
  liquidityAllocation?: LiquidityAllocation;
  migratedPoolFee?: MigratedPoolFeeConfiguration;
}>;
