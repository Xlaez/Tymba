import { MAX_CURVE_U128 } from "./curve.js";
import type { LiquidityAllocation } from "./migration.js";

export const LIQUIDITY_ALLOCATION_DENOMINATOR_BPS = 10_000n;

export type LiquidityAllocationAmounts = Readonly<{
  unlocked: bigint;
  permanentlyLocked: bigint;
  vesting: bigint;
}>;

export type PostMigrationLiquidityAllocation = Readonly<{
  distributableLiquidity: bigint;
  creator: LiquidityAllocationAmounts;
  partner: LiquidityAllocationAmounts;
}>;

export function calculatePostMigrationLiquidityAllocation(
  distributableLiquidity: bigint,
  allocation: LiquidityAllocation,
): PostMigrationLiquidityAllocation {
  validateLiquidity(distributableLiquidity);
  validateAllocation(allocation);

  const partnerPermanentlyLocked = share(
    distributableLiquidity,
    allocation.partner.permanentlyLockedBps,
  );
  const partnerVesting = share(distributableLiquidity, allocation.partner.vestingBps);
  const partnerUnlocked = share(distributableLiquidity, allocation.partner.unlockedBps);
  const creatorPermanentlyLocked = share(
    distributableLiquidity,
    allocation.creator.permanentlyLockedBps,
  );
  const creatorVesting = share(distributableLiquidity, allocation.creator.vestingBps);
  const creatorUnlocked =
    distributableLiquidity -
    partnerPermanentlyLocked -
    partnerVesting -
    partnerUnlocked -
    creatorPermanentlyLocked -
    creatorVesting;

  return {
    distributableLiquidity,
    creator: {
      unlocked: creatorUnlocked,
      permanentlyLocked: creatorPermanentlyLocked,
      vesting: creatorVesting,
    },
    partner: {
      unlocked: partnerUnlocked,
      permanentlyLocked: partnerPermanentlyLocked,
      vesting: partnerVesting,
    },
  };
}

function share(total: bigint, bps: bigint): bigint {
  return (total * bps) / LIQUIDITY_ALLOCATION_DENOMINATOR_BPS;
}

function validateLiquidity(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_CURVE_U128) {
    throw new RangeError("Distributable liquidity must be a non-negative u128 bigint");
  }
}

function validateAllocation(allocation: LiquidityAllocation): void {
  if (typeof allocation !== "object" || allocation === null) {
    throw new TypeError("Liquidity allocation must be an object");
  }

  const shares = [
    allocation.creator?.unlockedBps,
    allocation.creator?.permanentlyLockedBps,
    allocation.creator?.vestingBps,
    allocation.partner?.unlockedBps,
    allocation.partner?.permanentlyLockedBps,
    allocation.partner?.vestingBps,
  ];

  if (
    shares.some(
      (bps) =>
        typeof bps !== "bigint" ||
        bps < 0n ||
        bps > LIQUIDITY_ALLOCATION_DENOMINATOR_BPS ||
        bps % 100n !== 0n,
    )
  ) {
    throw new RangeError("Liquidity allocation shares must be whole percentages from 0 to 100");
  }

  if (shares.reduce((sum, bps) => sum + bps, 0n) !== LIQUIDITY_ALLOCATION_DENOMINATOR_BPS) {
    throw new RangeError("The six liquidity allocation shares must sum to 10000 basis points");
  }
}
