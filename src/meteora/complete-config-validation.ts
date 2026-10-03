import {
  calculateLockedLiquidityBpsAtTime,
  type LiquidityVestingInfoParameters,
  MIN_LOCKED_LIQUIDITY_BPS,
  SECONDS_PER_DAY,
  validateConfigParameters,
  validateLiquidityVestingInfo,
  validateMinimumLockedLiquidity,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import type { ConfigurationValidationIssue } from "../domain/configuration-validation.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";

type UnknownRecord = Record<string, unknown>;

export type CompleteSdkConfigCandidate = Parameters<typeof validateConfigParameters>[0];

export type CompleteSdkConfigValidationResult =
  | Readonly<{
      status: "valid";
      value: CompleteSdkConfigCandidate;
      evidence: Readonly<{
        sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
        lockedLiquidityBpsAtDayOne: number;
      }>;
    }>
  | Readonly<{
      status: "invalid";
      issues: readonly ConfigurationValidationIssue[];
    }>;

const UINT16_MAX = 65_535;
const UINT32_MAX = 4_294_967_295;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, code: string, message: string): CompleteSdkConfigValidationResult {
  return { status: "invalid", issues: [{ path, code, message }] };
}

function wholeNumberInRange(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function parseSchedule(value: unknown): LiquidityVestingInfoParameters | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !wholeNumberInRange(value.vestingPercentage, 100) ||
    !wholeNumberInRange(value.bpsPerPeriod, UINT16_MAX) ||
    !wholeNumberInRange(value.numberOfPeriods, UINT16_MAX) ||
    !wholeNumberInRange(value.cliffDurationFromMigrationTime, UINT32_MAX) ||
    !wholeNumberInRange(value.frequency, UINT32_MAX)
  ) {
    return undefined;
  }

  const schedule: LiquidityVestingInfoParameters = {
    vestingPercentage: value.vestingPercentage,
    bpsPerPeriod: value.bpsPerPeriod,
    numberOfPeriods: value.numberOfPeriods,
    cliffDurationFromMigrationTime: value.cliffDurationFromMigrationTime,
    frequency: value.frequency,
  };

  try {
    return validateLiquidityVestingInfo(schedule) ? schedule : undefined;
  } catch {
    return undefined;
  }
}

function hasCompleteTokenSupply(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const preMigration = value.preMigrationTokenSupply;
  const postMigration = value.postMigrationTokenSupply;
  return isSdkInteger(preMigration) && isSdkInteger(postMigration);
}

function isSdkInteger(value: unknown): boolean {
  if (!isRecord(value) || typeof value.toString !== "function") return false;
  try {
    return /^(0|[1-9][0-9]*)$/.test(String(value));
  } catch {
    return false;
  }
}

export function validateCompleteSdkConfigCandidate(
  input: unknown,
): CompleteSdkConfigValidationResult {
  try {
    if (!isRecord(input)) {
      return invalid(
        "$",
        "complete_candidate_required",
        "A complete Meteora SDK candidate is required.",
      );
    }

    const assembled = { ...input };

    if (
      !(assembled.leftoverReceiver instanceof PublicKey) ||
      assembled.leftoverReceiver.equals(PublicKey.default)
    ) {
      return invalid(
        "$.leftoverReceiver",
        "leftover_receiver_required",
        "A non-default leftover receiver public key is required for the fixed-supply candidate.",
      );
    }

    if (!hasCompleteTokenSupply(assembled.tokenSupply)) {
      return invalid(
        "$.tokenSupply",
        "complete_token_supply_required",
        "The complete pre-migration and post-migration token supply is required.",
      );
    }

    if (!wholeNumberInRange(assembled.partnerPermanentLockedLiquidityPercentage, 100)) {
      return invalid(
        "$.partnerPermanentLockedLiquidityPercentage",
        "invalid_locked_liquidity_percentage",
        "Partner permanent locked liquidity must be a whole percentage from 0 to 100.",
      );
    }

    if (!wholeNumberInRange(assembled.creatorPermanentLockedLiquidityPercentage, 100)) {
      return invalid(
        "$.creatorPermanentLockedLiquidityPercentage",
        "invalid_locked_liquidity_percentage",
        "Creator permanent locked liquidity must be a whole percentage from 0 to 100.",
      );
    }

    const partnerSchedule = parseSchedule(assembled.partnerLiquidityVestingInfo);
    if (!partnerSchedule) {
      return invalid(
        "$.partnerLiquidityVestingInfo",
        "invalid_vesting_schedule",
        "The complete partner liquidity vesting schedule is missing or invalid.",
      );
    }

    const creatorSchedule = parseSchedule(assembled.creatorLiquidityVestingInfo);
    if (!creatorSchedule) {
      return invalid(
        "$.creatorLiquidityVestingInfo",
        "invalid_vesting_schedule",
        "The complete creator liquidity vesting schedule is missing or invalid.",
      );
    }

    const lockedLiquidityBpsAtDayOne = calculateLockedLiquidityBpsAtTime(
      assembled.partnerPermanentLockedLiquidityPercentage,
      assembled.creatorPermanentLockedLiquidityPercentage,
      partnerSchedule,
      creatorSchedule,
      SECONDS_PER_DAY,
    );
    if (!Number.isSafeInteger(lockedLiquidityBpsAtDayOne) || lockedLiquidityBpsAtDayOne < 0) {
      return invalid(
        "$.liquidityDistribution",
        "locked_liquidity_calculation_failed",
        "The pinned Meteora SDK could not calculate day one locked liquidity.",
      );
    }

    if (
      !validateMinimumLockedLiquidity(
        assembled.partnerPermanentLockedLiquidityPercentage,
        assembled.creatorPermanentLockedLiquidityPercentage,
        partnerSchedule,
        creatorSchedule,
      )
    ) {
      return invalid(
        "$.liquidityDistribution",
        "day_one_locked_liquidity_below_minimum",
        `At least ${MIN_LOCKED_LIQUIDITY_BPS} bps must remain locked one day after migration; the complete schedules yield ${lockedLiquidityBpsAtDayOne} bps.`,
      );
    }

    const candidate = {
      ...assembled,
      partnerLiquidityVestingInfo: partnerSchedule,
      creatorLiquidityVestingInfo: creatorSchedule,
    } as CompleteSdkConfigCandidate;
    validateConfigParameters(candidate);

    return {
      status: "valid",
      value: candidate,
      evidence: {
        sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
        lockedLiquidityBpsAtDayOne,
      },
    };
  } catch {
    return invalid(
      "$",
      "meteora_sdk_rejected_config",
      "The pinned Meteora DBC SDK rejected the complete configuration.",
    );
  }
}
