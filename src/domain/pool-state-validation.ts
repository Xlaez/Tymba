import type {
  ConfigurationValidationIssue,
  ConfigurationValidationResult,
} from "./configuration-validation.js";
import {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "./configuration-validation.js";
import { MAX_CURVE_U64, MAX_CURVE_U128, validateDbcCurveShape } from "./curve.js";
import { quoteRequiredForSegments } from "./segment-math.js";
import type { CurrencyAmount } from "./currency-amount.js";
import { MAX_CURRENCY_DECIMALS } from "./currency-amount.js";
import type {
  AssetAmount,
  AssetAmountPair,
  AssetSide,
  DynamicFeeState,
  EconomicLedger,
  PoolState,
  PoolSupplyState,
  SimulationClock,
} from "./pool-state.js";

type UnknownRecord = Record<string, unknown>;

export type PoolStateValidationResult = ConfigurationValidationResult<PoolState>;

export function validatePoolState(input: unknown): PoolStateValidationResult {
  const issues: ConfigurationValidationIssue[] = [];
  const record = recordAt(input, "$", issues);
  if (!record) return { status: "invalid", issues };

  checkKeys(
    record,
    [
      "curve",
      "fees",
      "migration",
      "supply",
      "ledger",
      "currentSqrtPriceQ64x64",
      "clock",
      "activationPoint",
      "activationType",
      "migrationProgress",
      "hasSwapped",
      "dynamicFeeState",
    ],
    "$",
    issues,
  );

  const curveResult = validateDbcCurveShape(record.curve);
  if (curveResult.status === "invalid") {
    appendIssues(issues, "$.curve", curveResult.issues);
  }
  const curve = curveResult.status === "valid" ? curveResult.curve : undefined;

  const feeResult = validateFeeConfiguration(record.fees);
  if (feeResult.status === "invalid") {
    appendIssues(issues, "$.fees", feeResult.issues);
  }
  const fees = feeResult.status === "valid" ? feeResult.value : undefined;

  const migrationResult = validateMigrationConfiguration(record.migration);
  if (migrationResult.status === "invalid") {
    appendIssues(issues, "$.migration", migrationResult.issues);
  }
  const migration = migrationResult.status === "valid" ? migrationResult.value : undefined;

  const baseDecimals = curve?.baseDecimals;
  const quoteDecimals = curve?.quoteDecimals;
  const supply = supplyAt(record.supply, baseDecimals, issues);
  const ledger = ledgerAt(record.ledger, baseDecimals, quoteDecimals, issues);
  const currentSqrtPriceQ64x64 = u128At(
    record.currentSqrtPriceQ64x64,
    "$.currentSqrtPriceQ64x64",
    issues,
    true,
  );
  const clock = clockAt(record.clock, issues);
  const activationPoint = u64At(record.activationPoint, "$.activationPoint", issues);
  const activationType = enumAt(
    record.activationType,
    ["slot", "timestamp"],
    "$.activationType",
    issues,
  );
  if (
    fees &&
    fees.base.kind !== "fixed" &&
    activationType !== undefined &&
    fees.base.clock !== activationType
  ) {
    addIssue(
      issues,
      "$.activationType",
      "fee_clock_mismatch",
      "Activation clock must match the scheduled base fee clock",
    );
  }
  const migrationProgress = enumAt(
    record.migrationProgress,
    ["bonding", "curve-complete", "locked-vesting", "migrated"],
    "$.migrationProgress",
    issues,
  );
  const hasSwapped = booleanAt(record.hasSwapped, "$.hasSwapped", issues);
  const dynamicFeeState = Object.hasOwn(record, "dynamicFeeState")
    ? dynamicFeeStateAt(record.dynamicFeeState, issues)
    : undefined;

  if (curve && currentSqrtPriceQ64x64 !== undefined) {
    const lastSegment = curve.segments[curve.segments.length - 1];
    if (
      currentSqrtPriceQ64x64 < curve.startSqrtPriceQ64x64 ||
      (lastSegment && currentSqrtPriceQ64x64 > lastSegment.upperSqrtPriceQ64x64)
    ) {
      addIssue(
        issues,
        "$.currentSqrtPriceQ64x64",
        "price_outside_curve",
        "Current sqrt price must be within the configured curve boundaries",
      );
    }
  }

  if (curve && ledger && migrationProgress) {
    const quoteReserve = ledger.pool.quote.raw;
    const threshold = curve.migrationQuoteThresholdAtomic;
    if (migrationProgress === "bonding" && quoteReserve >= threshold) {
      addIssue(
        issues,
        "$.migrationProgress",
        "migration_status_mismatch",
        "A bonding pool cannot have reached its migration quote threshold",
      );
    }
    if (migrationProgress === "curve-complete" && quoteReserve < threshold) {
      addIssue(
        issues,
        "$.migrationProgress",
        "migration_status_mismatch",
        "A curve-complete pool must have reached its migration quote threshold",
      );
    }
    if (migrationProgress === "locked-vesting" || migrationProgress === "migrated") {
      if (ledger.pool.base.raw !== 0n || ledger.pool.quote.raw !== 0n) {
        addIssue(
          issues,
          "$.ledger.pool",
          "post_migration_reserve",
          "A migrated pool cannot retain DBC curve reserves",
        );
      }
      if (
        ledger.migration.dammLiquidity.base.raw === 0n ||
        ledger.migration.dammLiquidity.quote.raw === 0n
      ) {
        addIssue(
          issues,
          "$.ledger.migration.dammLiquidity",
          "missing_migrated_liquidity",
          "A migrated pool must record both DAMM v2 liquidity assets",
        );
      }
    }
  }

  if (curve) {
    const curveQuoteCapacity = quoteRequiredForSegments(curve.segments);
    if (curve.migrationQuoteThresholdAtomic > curveQuoteCapacity) {
      addIssue(
        issues,
        "$.curve.migrationQuoteThresholdAtomic",
        "threshold_exceeds_curve_capacity",
        "Migration quote threshold cannot exceed the quote traversable through the configured curve",
      );
    }
  }

  if (dynamicFeeState && !fees?.dynamic) {
    addIssue(
      issues,
      "$.dynamicFeeState",
      "missing_dynamic_fee_configuration",
      "Dynamic fee state requires a dynamic fee configuration",
    );
  }
  if (
    dynamicFeeState &&
    fees?.dynamic &&
    (dynamicFeeState.volatilityAccumulator > fees.dynamic.maxVolatilityAccumulator ||
      dynamicFeeState.volatilityReference > fees.dynamic.maxVolatilityAccumulator)
  ) {
    addIssue(
      issues,
      "$.dynamicFeeState.volatilityAccumulator",
      "out_of_range",
      "Dynamic volatility values cannot exceed the configured maximum accumulator",
    );
  }

  if (
    issues.length > 0 ||
    !curve ||
    !fees ||
    !migration ||
    !supply ||
    !ledger ||
    currentSqrtPriceQ64x64 === undefined ||
    !clock ||
    activationPoint === undefined ||
    !activationType ||
    !migrationProgress ||
    hasSwapped === undefined
  ) {
    return { status: "invalid", issues };
  }

  return {
    status: "valid",
    value: {
      curve,
      fees,
      migration,
      supply,
      ledger,
      currentSqrtPriceQ64x64,
      clock,
      activationPoint,
      activationType,
      migrationProgress,
      hasSwapped,
      ...(dynamicFeeState ? { dynamicFeeState } : {}),
    },
  };
}

function supplyAt(
  value: unknown,
  baseDecimals: number | undefined,
  issues: ConfigurationValidationIssue[],
): PoolSupplyState | undefined {
  const path = "$.supply";
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["mode", "totalBaseSupply", "baseDistributed"], path, issues);
  const mode = enumAt(record.mode, ["dynamic", "fixed"], `${path}.mode`, issues);
  const totalBaseSupply = assetAmountAt(
    record.totalBaseSupply,
    "base",
    baseDecimals,
    `${path}.totalBaseSupply`,
    issues,
  );
  const baseDistributed = assetAmountAt(
    record.baseDistributed,
    "base",
    baseDecimals,
    `${path}.baseDistributed`,
    issues,
  );

  if (totalBaseSupply && totalBaseSupply.amount.raw === 0n) {
    addIssue(
      issues,
      `${path}.totalBaseSupply.amount.raw`,
      "out_of_range",
      "Total base supply must be positive",
    );
  }
  if (
    totalBaseSupply &&
    baseDistributed &&
    baseDistributed.amount.raw > totalBaseSupply.amount.raw
  ) {
    addIssue(
      issues,
      `${path}.baseDistributed.amount.raw`,
      "supply_exceeded",
      "Distributed base amount cannot exceed total base supply",
    );
  }

  if (!mode || !totalBaseSupply || !baseDistributed) return undefined;
  return { mode, totalBaseSupply, baseDistributed };
}

function ledgerAt(
  value: unknown,
  baseDecimals: number | undefined,
  quoteDecimals: number | undefined,
  issues: ConfigurationValidationIssue[],
): EconomicLedger | undefined {
  const path = "$.ledger";
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["pool", "fees", "surplus", "migration", "leftoverBase"], path, issues);

  const pool = amountPairAt(record.pool, baseDecimals, quoteDecimals, `${path}.pool`, issues);
  const feesRecord = recordAt(record.fees, `${path}.fees`, issues);
  let fees: EconomicLedger["fees"] | undefined;
  if (feesRecord) {
    checkKeys(
      feesRecord,
      ["totalTrading", "protocol", "partner", "creator", "referral"],
      `${path}.fees`,
      issues,
    );
    const totalTrading = amountPairAt(
      feesRecord.totalTrading,
      baseDecimals,
      quoteDecimals,
      `${path}.fees.totalTrading`,
      issues,
    );
    const protocol = amountPairAt(
      feesRecord.protocol,
      baseDecimals,
      quoteDecimals,
      `${path}.fees.protocol`,
      issues,
    );
    const partner = amountPairAt(
      feesRecord.partner,
      baseDecimals,
      quoteDecimals,
      `${path}.fees.partner`,
      issues,
    );
    const creator = amountPairAt(
      feesRecord.creator,
      baseDecimals,
      quoteDecimals,
      `${path}.fees.creator`,
      issues,
    );
    const referral = amountPairAt(
      feesRecord.referral,
      baseDecimals,
      quoteDecimals,
      `${path}.fees.referral`,
      issues,
    );
    if (totalTrading && protocol && partner && creator && referral) {
      fees = { totalTrading, protocol, partner, creator, referral };
    }
  }

  const surplusRecord = recordAt(record.surplus, `${path}.surplus`, issues);
  let surplus: EconomicLedger["surplus"] | undefined;
  if (surplusRecord) {
    checkKeys(surplusRecord, ["protocol", "partner", "creator"], `${path}.surplus`, issues);
    const protocol = assetAmountAt(
      surplusRecord.protocol,
      "quote",
      quoteDecimals,
      `${path}.surplus.protocol`,
      issues,
    );
    const partner = assetAmountAt(
      surplusRecord.partner,
      "quote",
      quoteDecimals,
      `${path}.surplus.partner`,
      issues,
    );
    const creator = assetAmountAt(
      surplusRecord.creator,
      "quote",
      quoteDecimals,
      `${path}.surplus.creator`,
      issues,
    );
    if (protocol && partner && creator) surplus = { protocol, partner, creator };
  }

  const migrationRecord = recordAt(record.migration, `${path}.migration`, issues);
  let migration: EconomicLedger["migration"] | undefined;
  if (migrationRecord) {
    checkKeys(
      migrationRecord,
      ["partnerFee", "creatorFee", "protocolLiquidityFee", "dammLiquidity"],
      `${path}.migration`,
      issues,
    );
    const partnerFee = assetAmountAt(
      migrationRecord.partnerFee,
      "quote",
      quoteDecimals,
      `${path}.migration.partnerFee`,
      issues,
    );
    const creatorFee = assetAmountAt(
      migrationRecord.creatorFee,
      "quote",
      quoteDecimals,
      `${path}.migration.creatorFee`,
      issues,
    );
    const protocolLiquidityFee = amountPairAt(
      migrationRecord.protocolLiquidityFee,
      baseDecimals,
      quoteDecimals,
      `${path}.migration.protocolLiquidityFee`,
      issues,
    );
    const dammLiquidity = amountPairAt(
      migrationRecord.dammLiquidity,
      baseDecimals,
      quoteDecimals,
      `${path}.migration.dammLiquidity`,
      issues,
    );
    if (partnerFee && creatorFee && protocolLiquidityFee && dammLiquidity) {
      migration = { partnerFee, creatorFee, protocolLiquidityFee, dammLiquidity };
    }
  }

  const leftoverBase = assetAmountAt(
    record.leftoverBase,
    "base",
    baseDecimals,
    `${path}.leftoverBase`,
    issues,
  );
  if (!pool || !fees || !surplus || !migration || !leftoverBase) return undefined;
  return { pool, fees, surplus, migration, leftoverBase };
}

function amountPairAt(
  value: unknown,
  baseDecimals: number | undefined,
  quoteDecimals: number | undefined,
  path: string,
  issues: ConfigurationValidationIssue[],
): AssetAmountPair | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["base", "quote"], path, issues);
  const base = currencyAmountAt(record.base, baseDecimals, `${path}.base`, issues);
  const quote = currencyAmountAt(record.quote, quoteDecimals, `${path}.quote`, issues);
  if (!base || !quote) return undefined;
  return { base, quote };
}

function assetAmountAt<Asset extends AssetSide>(
  value: unknown,
  expectedAsset: Asset,
  expectedDecimals: number | undefined,
  path: string,
  issues: ConfigurationValidationIssue[],
): AssetAmount<Asset> | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["asset", "amount"], path, issues);
  if (record.asset !== expectedAsset) {
    addIssue(issues, `${path}.asset`, "asset_mismatch", `Expected ${expectedAsset} asset amount`);
  }
  const amount = currencyAmountAt(record.amount, expectedDecimals, `${path}.amount`, issues);
  if (!amount || record.asset !== expectedAsset) return undefined;
  return { asset: expectedAsset, amount };
}

function currencyAmountAt(
  value: unknown,
  expectedDecimals: number | undefined,
  path: string,
  issues: ConfigurationValidationIssue[],
): CurrencyAmount | undefined {
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["raw", "decimals"], path, issues);
  const raw = bigintAt(record.raw, `${path}.raw`, issues);
  const decimals = integerAt(record.decimals, `${path}.decimals`, issues);

  if (raw !== undefined && (raw < 0n || raw > MAX_CURVE_U64)) {
    addIssue(issues, `${path}.raw`, "out_of_range", "Amount must be a non-negative u64 bigint");
  }
  if (decimals !== undefined && (decimals < 0 || decimals > MAX_CURRENCY_DECIMALS)) {
    addIssue(
      issues,
      `${path}.decimals`,
      "out_of_range",
      `Decimals must be an integer from 0 to ${MAX_CURRENCY_DECIMALS}`,
    );
  }
  if (decimals !== undefined && expectedDecimals !== undefined && decimals !== expectedDecimals) {
    addIssue(
      issues,
      `${path}.decimals`,
      "decimal_mismatch",
      `Decimals must match the configured asset scale of ${expectedDecimals}`,
    );
  }

  if (
    raw === undefined ||
    decimals === undefined ||
    raw < 0n ||
    raw > MAX_CURVE_U64 ||
    decimals < 0 ||
    decimals > MAX_CURRENCY_DECIMALS ||
    (expectedDecimals !== undefined && decimals !== expectedDecimals)
  ) {
    return undefined;
  }
  return { raw, decimals };
}

function clockAt(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): SimulationClock | undefined {
  const path = "$.clock";
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(record, ["slot", "timestampSeconds"], path, issues);
  const slot = u64At(record.slot, `${path}.slot`, issues);
  const timestampSeconds = u64At(record.timestampSeconds, `${path}.timestampSeconds`, issues);
  if (slot === undefined || timestampSeconds === undefined) return undefined;
  return { slot, timestampSeconds };
}

function dynamicFeeStateAt(
  value: unknown,
  issues: ConfigurationValidationIssue[],
): DynamicFeeState | undefined {
  const path = "$.dynamicFeeState";
  const record = recordAt(value, path, issues);
  if (!record) return undefined;
  checkKeys(
    record,
    [
      "lastUpdateTimestamp",
      "sqrtPriceReferenceQ64x64",
      "volatilityAccumulator",
      "volatilityReference",
    ],
    path,
    issues,
  );
  const lastUpdateTimestamp = u64At(
    record.lastUpdateTimestamp,
    `${path}.lastUpdateTimestamp`,
    issues,
  );
  const sqrtPriceReferenceQ64x64 = u128At(
    record.sqrtPriceReferenceQ64x64,
    `${path}.sqrtPriceReferenceQ64x64`,
    issues,
    true,
  );
  const volatilityAccumulator = u128At(
    record.volatilityAccumulator,
    `${path}.volatilityAccumulator`,
    issues,
    false,
  );
  const volatilityReference = u128At(
    record.volatilityReference,
    `${path}.volatilityReference`,
    issues,
    false,
  );
  if (
    lastUpdateTimestamp === undefined ||
    sqrtPriceReferenceQ64x64 === undefined ||
    volatilityAccumulator === undefined ||
    volatilityReference === undefined
  ) {
    return undefined;
  }
  return {
    lastUpdateTimestamp,
    sqrtPriceReferenceQ64x64,
    volatilityAccumulator,
    volatilityReference,
  };
}

function u64At(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): bigint | undefined {
  const result = bigintAt(value, path, issues);
  if (result !== undefined && (result < 0n || result > MAX_CURVE_U64)) {
    addIssue(issues, path, "out_of_range", "Must be a non-negative u64 bigint");
    return undefined;
  }
  return result;
}

function u128At(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
  positive: boolean,
): bigint | undefined {
  const result = bigintAt(value, path, issues);
  if (result !== undefined && (result < (positive ? 1n : 0n) || result > MAX_CURVE_U128)) {
    addIssue(
      issues,
      path,
      "out_of_range",
      positive ? "Must be a positive u128 bigint" : "Must be a non-negative u128 bigint",
    );
    return undefined;
  }
  return result;
}

function bigintAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): bigint | undefined {
  if (typeof value !== "bigint") {
    addIssue(issues, path, "invalid_integer", "Expected a bigint value");
    return undefined;
  }
  return value;
}

function integerAt(
  value: unknown,
  path: string,
  issues: ConfigurationValidationIssue[],
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    addIssue(issues, path, "invalid_integer", "Expected an integer value");
    return undefined;
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

function appendIssues(
  target: ConfigurationValidationIssue[],
  prefix: string,
  source: readonly ConfigurationValidationIssue[],
): void {
  for (const issue of source) {
    target.push({
      ...issue,
      path: issue.path === "$" ? prefix : `${prefix}${issue.path.slice(1)}`,
    });
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
