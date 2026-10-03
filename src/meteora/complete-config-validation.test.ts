import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  fromDecimalToBN,
  type LiquidityDistributionConfig,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { validateCompleteSdkConfigCandidate } from "./complete-config-validation.js";

const Q64_ONE = 18_446_744_073_709_551_616n;
const LEFTOVER_RECEIVER = new PublicKey(new Uint8Array(32).fill(1));

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

function buildCandidate(
  liquidityDistribution: LiquidityDistributionConfig = {
    partnerPermanentLockedLiquidityPercentage: 5,
    partnerLiquidityPercentage: 45,
    creatorPermanentLockedLiquidityPercentage: 5,
    creatorLiquidityPercentage: 45,
  },
) {
  const config = buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.NINE,
      tokenQuoteDecimal: 6,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 100,
          endingFeeBps: 100,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution,
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices: [Q64_ONE, Q64_ONE * 2n].map(sdkInteger),
  });

  return { ...config, leftoverReceiver: LEFTOVER_RECEIVER };
}

describe("complete pinned Meteora config validation", () => {
  it("validates the complete SDK candidate and reports day one liquidity from both schedules", () => {
    const candidate = buildCandidate({
      partnerPermanentLockedLiquidityPercentage: 5,
      partnerLiquidityPercentage: 45,
      partnerLiquidityVestingInfoParams: {
        vestingPercentage: 1,
        bpsPerPeriod: 10_000,
        numberOfPeriods: 1,
        cliffDurationFromMigrationTime: 172_800,
        totalDuration: 345_600,
      },
      creatorPermanentLockedLiquidityPercentage: 5,
      creatorLiquidityPercentage: 44,
    });

    const result = validateCompleteSdkConfigCandidate(candidate);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("Expected a valid SDK config candidate");
    expect(result.value).not.toBe(candidate);
    expect(result.value.leftoverReceiver).toBe(LEFTOVER_RECEIVER);
    expect(result.value.partnerLiquidityVestingInfo).toEqual(candidate.partnerLiquidityVestingInfo);
    expect(result.value.creatorLiquidityVestingInfo).toEqual(candidate.creatorLiquidityVestingInfo);
    expect(result.evidence).toEqual({
      sdkVersion: "1.5.13",
      lockedLiquidityBpsAtDayOne: 1_099,
    });
  });

  it("rejects a candidate below the one day minimum using its complete schedules", () => {
    const candidate = buildCandidate({
      partnerPermanentLockedLiquidityPercentage: 4,
      partnerLiquidityPercentage: 45,
      partnerLiquidityVestingInfoParams: {
        vestingPercentage: 1,
        bpsPerPeriod: 10_000,
        numberOfPeriods: 1,
        cliffDurationFromMigrationTime: 172_800,
        totalDuration: 345_600,
      },
      creatorPermanentLockedLiquidityPercentage: 5,
      creatorLiquidityPercentage: 45,
    });

    const result = validateCompleteSdkConfigCandidate(candidate);

    expect(result).toMatchObject({
      status: "invalid",
      issues: [
        {
          path: "$.liquidityDistribution",
          code: "day_one_locked_liquidity_below_minimum",
          message: expect.stringContaining("yield 999 bps"),
        },
      ],
    });
  });

  it("requires full schedules, fixed-supply amounts, and a non-default receiver", () => {
    const candidate = buildCandidate();

    expect(
      validateCompleteSdkConfigCandidate({ ...candidate, partnerLiquidityVestingInfo: undefined }),
    ).toMatchObject({ status: "invalid", issues: [{ code: "invalid_vesting_schedule" }] });
    expect(
      validateCompleteSdkConfigCandidate({ ...candidate, tokenSupply: undefined }),
    ).toMatchObject({ status: "invalid", issues: [{ code: "complete_token_supply_required" }] });
    expect(
      validateCompleteSdkConfigCandidate({ ...candidate, leftoverReceiver: PublicKey.default }),
    ).toMatchObject({ status: "invalid", issues: [{ code: "leftover_receiver_required" }] });
  });

  it("sanitizes SDK validation failures", () => {
    const result = validateCompleteSdkConfigCandidate({
      ...buildCandidate(),
      migrationOption: 99,
    });

    expect(result).toMatchObject({
      status: "invalid",
      issues: [
        {
          path: "$",
          code: "meteora_sdk_rejected_config",
          message: "The pinned Meteora DBC SDK rejected the complete configuration.",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Invalid migration option");
  });
});
