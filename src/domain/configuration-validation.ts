import type {
  FeeConfiguration,
  FeeClock,
  FeeCollectionMode,
  MigratedPoolFeeConfiguration,
} from "./fees.js";
import type {
  LiquidityAllocation,
  LiquidityAllocationShare,
  MigrationAllocationIntent,
  MigrationConfiguration,
  MigrationFeeConfiguration,
} from "./migration.js";
import type { ValidationStatus } from "./status.js";

const MAX_BASIS_POINTS = 10_000n;
const MIN_BASE_FEE_BPS = 25n;
const MAX_BASE_FEE_BPS = 9_900n;
const MIN_MIGRATED_POOL_FEE_BPS = 10n;
const MAX_MIGRATED_POOL_FEE_BPS = 1_000n;
const MAX_MIGRATION_FEE_BPS = 9_900n;
const MAX_LOCK_DURATION_SECONDS = 63_072_000n;
const U16_MAX = (1n << 16n) - 1n;
const U24_MAX = (1n << 24n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

export type ConfigurationValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type ConfigurationValidationResult<Value> =
  | Readonly<{ status: Extract<ValidationStatus, "valid">; value: Value }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly ConfigurationValidationIssue[];
    }>;

export type FeeConfigurationValidationResult = ConfigurationValidationResult<FeeConfiguration>;

export type MigrationConfigurationValidationResult =
  ConfigurationValidationResult<MigrationConfiguration>;

type UnknownRecord = Record<string, unknown>;

export function validateFeeConfiguration(input: unknown): FeeConfigurationValidationResult {
  const issues: ConfigurationValidationIssue[] = [];
  const record = recordAt(input, "$", issues);
  if (!record) return { status: "invalid", issues };

  checkKeys(
    record,
    ["base", "dynamic", "collectFeeMode", "creatorTradingFeeShareBps", "migratedPool"],
    "$",
    issues,
  );

  const base = parseBaseFeeSchedule(record.base, "$.base", issues);
  const dynamic = Object.hasOwn(record, "dynamic")
    ? parseDynamicFee(record.dynamic, "$.dynamic", issues)
    : undefined;
  const collectFeeMode = enumAt(
    record.collectFeeMode,
    ["quote", "output"],
    "$.collectFeeMode",
    issues,
  ) as FeeCollectionMode | undefined;
  const creatorTradingFeeShareBps = wholePercentBpsAt(
    record.creatorTradingFeeShareBps,
    "$.creatorTradingFeeShareBps",
    issues,
  );
  const migratedPool = Object.hasOwn(record, "migratedPool")
    ? parseMigratedPoolFee(record.migratedPool, "$.migratedPool", issues)
    : undefined;

  if (issues.length > 0 || !base || !collectFeeMode || creatorTradingFeeShareBps === undefined) {
    return { status: "invalid", issues };
  }

  return {
    status: "valid",
    value: {
      base,
      ...(dynamic ? { dynamic } : {}),
      collectFeeMode,
      creatorTradingFeeShareBps,
      ...(migratedPool ? { migratedPool } : {}),
    },
  };
}

export function validateMigrationConfiguration(
  input: unknown,
): MigrationConfigurationValidationResult {
  const issues: ConfigurationValidationIssue[] = [];
  const record = recordAt(input, "$", issues);
  if (!record) return { status: "invalid", issues };

  checkKeys(
    record,
    ["destination", "fee", "allocationIntent", "liquidityAllocation", "migratedPoolFee"],
    "$",
    issues,
  );

  const destination = enumAt(record.destination, ["damm-v2"], "$.destination", issues);
  const fee = Object.hasOwn(record, "fee")
    ? parseMigrationFee(record.fee, "$.fee", issues)
    : undefined;
  const allocationIntent = Object.hasOwn(record, "allocationIntent")
    ? parseAllocationIntent(record.allocationIntent, "$.allocationIntent", issues)
    : undefined;
  const liquidityAllocation = Object.hasOwn(record, "liquidityAllocation")
    ? parseLiquidityAllocation(record.liquidityAllocation, "$.liquidityAllocation", issues)
    : undefined;
  const migratedPoolFee = Object.hasOwn(record, "migratedPoolFee")
    ? parseMigratedPoolFee(record.migratedPoolFee, "$.migratedPoolFee", issues)
    : undefined;

  if (
    issues.length > 0 ||
    destination !== "damm-v2" ||
    (Object.hasOwn(record, "fee") && !fee) ||
    (Object.hasOwn(record, "allocationIntent") && !allocationIntent) ||
    (Object.hasOwn(record, "liquidityAllocation") && !liquidityAllocation) ||
    (Object.hasOwn(record, "migratedPoolFee") && !migratedPoolFee)
  ) {
    return { status: "invalid", issues };
  }

  return {
    status: "valid",
    value: {
      destination,
      ...(fee ? { fee } : {}),
      ...(allocationIntent ? { allocationIntent } : {}),
      ...(liquidityAllocation ? { liquidityAllocation } : {}),
      ...(migratedPoolFee ? { migratedPoolFee } : {}),
    },
  };
}

function parseBaseFeeSchedule(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): FeeConfiguration["base"] | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  const kind = stringAt(record.kind, `${path}.kind`, issues);

  if (kind === "fixed") {
    checkKeys(record, ["kind", "feeBps"], path, issues);
    const feeBps = boundedBigintAt(
      record.feeBps,
      `${path}.feeBps`,
      MIN_BASE_FEE_BPS,
      MAX_BASE_FEE_BPS,
      issues,
    );
    return feeBps === undefined ? undefined : { kind, feeBps };
  }

  if (kind === "linear" || kind === "exponential") {
    checkKeys(
      record,
      ["kind", "startingFeeBps", "endingFeeBps", "periodCount", "periodFrequency", "clock"],
      path,
      issues,
    );
    const startingFeeBps = boundedBigintAt(
      record.startingFeeBps,
      `${path}.startingFeeBps`,
      MIN_BASE_FEE_BPS,
      MAX_BASE_FEE_BPS,
      issues,
    );
    const endingFeeBps = boundedBigintAt(
      record.endingFeeBps,
      `${path}.endingFeeBps`,
      MIN_BASE_FEE_BPS,
      MAX_BASE_FEE_BPS,
      issues,
    );
    const periodCount = boundedBigintAt(
      record.periodCount,
      `${path}.periodCount`,
      1n,
      U16_MAX,
      issues,
    );
    const periodFrequency = boundedBigintAt(
      record.periodFrequency,
      `${path}.periodFrequency`,
      1n,
      U64_MAX,
      issues,
    );
    const clock = enumAt(record.clock, ["slot", "timestamp"], `${path}.clock`, issues) as
      | FeeClock
      | undefined;

    if (
      startingFeeBps !== undefined &&
      endingFeeBps !== undefined &&
      startingFeeBps <= endingFeeBps
    ) {
      addIssue(
        issues,
        `${path}.endingFeeBps`,
        "non_decreasing_schedule",
        "A scheduled base fee must decline; use a fixed fee when the start and end fees are equal",
      );
    }

    if (
      startingFeeBps === undefined ||
      endingFeeBps === undefined ||
      periodCount === undefined ||
      periodFrequency === undefined ||
      !clock
    ) {
      return undefined;
    }
    return { kind, startingFeeBps, endingFeeBps, periodCount, periodFrequency, clock };
  }

  if (kind !== undefined) {
    addIssue(issues, `${path}.kind`, "unsupported_value", "Expected fixed, linear, or exponential");
  }
  return undefined;
}

function parseDynamicFee(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): FeeConfiguration["dynamic"] {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(
    record,
    [
      "binStepBps",
      "filterPeriodSeconds",
      "decayPeriodSeconds",
      "reductionFactorBps",
      "maxVolatilityAccumulator",
      "variableFeeControl",
    ],
    path,
    issues,
  );

  const binStepBps = boundedBigintAt(record.binStepBps, `${path}.binStepBps`, 1n, 1n, issues);
  const filterPeriodSeconds = boundedBigintAt(
    record.filterPeriodSeconds,
    `${path}.filterPeriodSeconds`,
    0n,
    U16_MAX,
    issues,
  );
  const decayPeriodSeconds = boundedBigintAt(
    record.decayPeriodSeconds,
    `${path}.decayPeriodSeconds`,
    1n,
    U16_MAX,
    issues,
  );
  const reductionFactorBps = boundedBigintAt(
    record.reductionFactorBps,
    `${path}.reductionFactorBps`,
    0n,
    MAX_BASIS_POINTS,
    issues,
  );
  const maxVolatilityAccumulator = boundedBigintAt(
    record.maxVolatilityAccumulator,
    `${path}.maxVolatilityAccumulator`,
    0n,
    U24_MAX,
    issues,
  );
  const variableFeeControl = boundedBigintAt(
    record.variableFeeControl,
    `${path}.variableFeeControl`,
    0n,
    U24_MAX,
    issues,
  );

  if (
    filterPeriodSeconds !== undefined &&
    decayPeriodSeconds !== undefined &&
    filterPeriodSeconds >= decayPeriodSeconds
  ) {
    addIssue(
      issues,
      `${path}.filterPeriodSeconds`,
      "invalid_period_order",
      "Filter period must be shorter than decay period",
    );
  }

  if (
    binStepBps === undefined ||
    filterPeriodSeconds === undefined ||
    decayPeriodSeconds === undefined ||
    reductionFactorBps === undefined ||
    maxVolatilityAccumulator === undefined ||
    variableFeeControl === undefined
  ) {
    return undefined;
  }
  return {
    binStepBps,
    filterPeriodSeconds,
    decayPeriodSeconds,
    reductionFactorBps,
    maxVolatilityAccumulator,
    variableFeeControl,
  };
}

function parseMigratedPoolFee(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): MigratedPoolFeeConfiguration | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(
    record,
    ["feeBps", "collectFeeMode", "dynamicFeeEnabled", "compoundingFeeBps"],
    path,
    issues,
  );

  const feeBps = boundedBigintAt(
    record.feeBps,
    `${path}.feeBps`,
    MIN_MIGRATED_POOL_FEE_BPS,
    MAX_MIGRATED_POOL_FEE_BPS,
    issues,
  );
  const collectFeeMode = enumAt(
    record.collectFeeMode,
    ["quote", "output", "compounding"],
    `${path}.collectFeeMode`,
    issues,
  );
  const dynamicFeeEnabled = booleanAt(
    record.dynamicFeeEnabled,
    `${path}.dynamicFeeEnabled`,
    issues,
  );
  const hasCompoundingFeeBps = Object.hasOwn(record, "compoundingFeeBps");
  const compoundingFeeBps = hasCompoundingFeeBps
    ? boundedBigintAt(
        record.compoundingFeeBps,
        `${path}.compoundingFeeBps`,
        1n,
        MAX_BASIS_POINTS,
        issues,
      )
    : undefined;

  if (collectFeeMode === "compounding" && !hasCompoundingFeeBps) {
    addIssue(
      issues,
      `${path}.compoundingFeeBps`,
      "required_for_compounding",
      "Compounding fee mode requires compoundingFeeBps",
    );
  }
  if (
    collectFeeMode !== undefined &&
    collectFeeMode !== "compounding" &&
    compoundingFeeBps !== undefined
  ) {
    addIssue(
      issues,
      `${path}.compoundingFeeBps`,
      "unexpected_value",
      "compoundingFeeBps is only supported for compounding fee mode",
    );
  }
  if (feeBps === undefined || !collectFeeMode || dynamicFeeEnabled === undefined) return undefined;
  return {
    feeBps,
    collectFeeMode,
    dynamicFeeEnabled,
    ...(compoundingFeeBps === undefined ? {} : { compoundingFeeBps }),
  };
}

function parseMigrationFee(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): MigrationFeeConfiguration | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["feeBps", "creatorFeeShareBps"], path, issues);

  const feeBps = wholePercentBpsAt(record.feeBps, `${path}.feeBps`, issues, MAX_MIGRATION_FEE_BPS);
  const creatorFeeShareBps = wholePercentBpsAt(
    record.creatorFeeShareBps,
    `${path}.creatorFeeShareBps`,
    issues,
  );
  if (feeBps === 0n && creatorFeeShareBps !== undefined && creatorFeeShareBps !== 0n) {
    addIssue(
      issues,
      `${path}.creatorFeeShareBps`,
      "creator_share_without_fee",
      "Creator migration-fee share must be zero when the migration fee is zero",
    );
  }
  if (feeBps === undefined || creatorFeeShareBps === undefined) return undefined;
  return { feeBps, creatorFeeShareBps };
}

function parseAllocationIntent(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): MigrationAllocationIntent | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(
    record,
    ["creatorLockedBps", "partnerLockedBps", "unlockedBps", "lockDurationSeconds"],
    path,
    issues,
  );

  const creatorLockedBps = boundedBigintAt(
    record.creatorLockedBps,
    `${path}.creatorLockedBps`,
    0n,
    MAX_BASIS_POINTS,
    issues,
  );
  const partnerLockedBps = boundedBigintAt(
    record.partnerLockedBps,
    `${path}.partnerLockedBps`,
    0n,
    MAX_BASIS_POINTS,
    issues,
  );
  const unlockedBps = boundedBigintAt(
    record.unlockedBps,
    `${path}.unlockedBps`,
    0n,
    MAX_BASIS_POINTS,
    issues,
  );
  const lockDurationSeconds = Object.hasOwn(record, "lockDurationSeconds")
    ? boundedBigintAt(
        record.lockDurationSeconds,
        `${path}.lockDurationSeconds`,
        1n,
        MAX_LOCK_DURATION_SECONDS,
        issues,
      )
    : undefined;

  if (
    creatorLockedBps !== undefined &&
    partnerLockedBps !== undefined &&
    unlockedBps !== undefined &&
    creatorLockedBps + partnerLockedBps + unlockedBps !== MAX_BASIS_POINTS
  ) {
    addIssue(issues, path, "allocation_sum", "Intent allocations must sum to 10000 basis points");
  }
  if (
    creatorLockedBps !== undefined &&
    partnerLockedBps !== undefined &&
    creatorLockedBps + partnerLockedBps < 1_000n
  ) {
    addIssue(
      issues,
      path,
      "minimum_locked_allocation",
      "Creator and partner locked intent must total at least 1000 basis points",
    );
  }

  if (
    creatorLockedBps === undefined ||
    partnerLockedBps === undefined ||
    unlockedBps === undefined ||
    (Object.hasOwn(record, "lockDurationSeconds") && lockDurationSeconds === undefined)
  ) {
    return undefined;
  }
  return {
    creatorLockedBps,
    partnerLockedBps,
    unlockedBps,
    ...(lockDurationSeconds === undefined ? {} : { lockDurationSeconds }),
  };
}

function parseLiquidityAllocation(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): LiquidityAllocation | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["creator", "partner"], path, issues);
  const creator = parseLiquidityAllocationShare(record.creator, `${path}.creator`, issues);
  const partner = parseLiquidityAllocationShare(record.partner, `${path}.partner`, issues);

  if (creator && partner) {
    const total =
      creator.unlockedBps +
      creator.permanentlyLockedBps +
      creator.vestingBps +
      partner.unlockedBps +
      partner.permanentlyLockedBps +
      partner.vestingBps;
    if (total !== MAX_BASIS_POINTS) {
      addIssue(
        issues,
        path,
        "allocation_sum",
        "The six protocol liquidity allocations must sum to 10000 basis points",
      );
    }
  }
  if (!creator || !partner) return undefined;
  return { creator, partner };
}

function parseLiquidityAllocationShare(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): LiquidityAllocationShare | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["unlockedBps", "permanentlyLockedBps", "vestingBps"], path, issues);
  const unlockedBps = wholePercentBpsAt(record.unlockedBps, `${path}.unlockedBps`, issues);
  const permanentlyLockedBps = wholePercentBpsAt(
    record.permanentlyLockedBps,
    `${path}.permanentlyLockedBps`,
    issues,
  );
  const vestingBps = wholePercentBpsAt(record.vestingBps, `${path}.vestingBps`, issues);
  if (unlockedBps === undefined || permanentlyLockedBps === undefined || vestingBps === undefined) {
    return undefined;
  }
  return { unlockedBps, permanentlyLockedBps, vestingBps };
}

function wholePercentBpsAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
  maximum = MAX_BASIS_POINTS,
): bigint | undefined {
  const bps = boundedBigintAt(value, path, 0n, maximum, issues);
  if (bps !== undefined && bps % 100n !== 0n) {
    addIssue(
      issues,
      path,
      "unsupported_precision",
      "This SDK field supports whole percentages only",
    );
  }
  return bps;
}

function boundedBigintAt(
  value: unknown,
  path: string,
  minimum: bigint,
  maximum: bigint,
  issues: ConfigurationValidationIssue[],
): bigint | undefined {
  if (typeof value !== "bigint") {
    addIssue(issues, path, "invalid_integer", "Expected a bigint value");
    return undefined;
  }
  if (value < minimum || value > maximum) {
    addIssue(issues, path, "out_of_range", `Must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumAt<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  issues: ConfigurationValidationIssue[],
): Value | undefined {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    addIssue(issues, path, "unsupported_value", `Expected one of: ${allowed.join(", ")}`);
    return undefined;
  }
  return value as Value;
}

function stringAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_value", "Expected a string value");
    return undefined;
  }
  return value;
}

function booleanAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    addIssue(issues, path, "invalid_value", "Expected a boolean value");
    return undefined;
  }
  return value;
}

function recordAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue(issues, path, "invalid_object", "Expected an object");
    return undefined;
  }
  return value as UnknownRecord;
}

function checkKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: ConfigurationValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      addIssue(issues, `${path}.${key}`, "unknown_field", "Field is not supported");
    }
  }
}

function addIssue(
  issues: ConfigurationValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}
