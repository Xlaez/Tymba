import { Decimal } from "decimal.js";
import { parseCurrencyAmount } from "./currency-amount.js";
import { MAX_PUBLIC_BUILDER_SEGMENTS } from "./curve.js";
import { DEFAULT_SOLVER_SEGMENT_COUNT } from "./solver-constants.js";
import type { ValidationStatus } from "./status.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100000, toExpPos: 100000 });
const MAX_DECIMAL_LENGTH = 256;
const MAX_SEGMENTS = MAX_PUBLIC_BUILDER_SEGMENTS;
const MAX_LOCK_DURATION_SECONDS = 63_072_000n;

export type DecimalString = string;

export type AssetDefinition = Readonly<{
  symbol: string;
  decimals: number;
  mint?: string;
}>;

export type MarketIntent = Readonly<{
  assets: Readonly<{
    base: AssetDefinition;
    quote: AssetDefinition;
  }>;
  supply: Readonly<{
    totalBase: DecimalString;
  }>;
  pricing: Readonly<{
    startPrice?: DecimalString;
    startFdv?: DecimalString;
    migrationPrice?: DecimalString;
    migrationFdv?: DecimalString;
  }>;
  targets: Readonly<{
    quoteToMigration?: DecimalString;
    baseDistributionPct?: DecimalString;
  }>;
  preferences?: Readonly<{
    launchProfile?: "deep" | "balanced" | "momentum";
    maxEarlyPriceImpactPct?: DecimalString;
    earlyBuyerAdvantagePct?: DecimalString;
    sniperResistance?: "low" | "medium" | "high";
  }>;
  solver?: Readonly<{
    maxSegments?: number;
  }>;
  migration?: Readonly<{
    creatorLockedPct?: DecimalString;
    partnerLockedPct?: DecimalString;
    unlockedPct?: DecimalString;
    lockDurationSeconds?: string;
  }>;
}>;

export type NormalizedMarketIntent = Readonly<{
  assets: Readonly<{
    base: AssetDefinition;
    quote: AssetDefinition;
  }>;
  baseDecimals: number;
  quoteDecimals: number;
  totalBaseAtomic: bigint;
  startPrice: Decimal;
  startFdv: Decimal;
  migrationPrice: Decimal;
  migrationFdv: Decimal;
  quoteToMigrationAtomic?: bigint;
  targetBaseDistributionBps?: bigint;
  launchProfile?: "deep" | "balanced" | "momentum";
  maxEarlyPriceImpactBps?: bigint;
  earlyBuyerAdvantageBps?: bigint;
  sniperResistance?: "low" | "medium" | "high";
  maxSegments: number;
  migration?: Readonly<{
    creatorLockedBps?: bigint;
    partnerLockedBps?: bigint;
    unlockedBps?: bigint;
    lockDurationSeconds?: bigint;
  }>;
}>;

export type MarketIntentIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type MarketIntentValidationResult =
  | Readonly<{
      status: Extract<ValidationStatus, "valid">;
      intent: MarketIntent;
      normalized: NormalizedMarketIntent;
    }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly MarketIntentIssue[];
    }>;

type UnknownRecord = Record<string, unknown>;
type DecimalEntry = Readonly<{ value: Decimal; text: string }>;

export function validateMarketIntent(input: unknown): MarketIntentValidationResult {
  const issues: MarketIntentIssue[] = [];
  const root = recordAt(input, "$", issues);
  if (!root) return { status: "invalid", issues };

  checkKeys(
    root,
    ["assets", "supply", "pricing", "targets", "preferences", "solver", "migration"],
    "$",
    issues,
  );

  const assets = requiredRecord(root, "assets", "$.assets", issues);
  const baseRecord = assets ? requiredRecord(assets, "base", "$.assets.base", issues) : undefined;
  const quoteRecord = assets
    ? requiredRecord(assets, "quote", "$.assets.quote", issues)
    : undefined;
  const base = baseRecord ? parseAsset(baseRecord, "$.assets.base", true, issues) : undefined;
  const quote = quoteRecord ? parseAsset(quoteRecord, "$.assets.quote", false, issues) : undefined;
  if (base?.mint && quote?.mint && base.mint === quote.mint) {
    addIssue(
      issues,
      "$.assets",
      "duplicate_mint",
      "Base and quote assets must use different mints",
    );
  }

  const supplyRecord = requiredRecord(root, "supply", "$.supply", issues);
  if (supplyRecord) checkKeys(supplyRecord, ["totalBase"], "$.supply", issues);
  const totalBase = supplyRecord
    ? decimalAt(supplyRecord.totalBase, "$.supply.totalBase", issues, true)
    : undefined;
  if (totalBase?.value.isZero()) {
    addIssue(
      issues,
      "$.supply.totalBase",
      "must_be_positive",
      "Total base supply must be greater than zero",
    );
  }
  const parsedBase =
    totalBase && base
      ? atomicAt(totalBase, base.decimals, "$.supply.totalBase", issues)
      : undefined;

  const pricing = requiredRecord(root, "pricing", "$.pricing", issues);
  if (pricing)
    checkKeys(
      pricing,
      ["startPrice", "startFdv", "migrationPrice", "migrationFdv"],
      "$.pricing",
      issues,
    );
  const startPrice = pricing
    ? decimalAt(pricing.startPrice, "$.pricing.startPrice", issues, false)
    : undefined;
  const startFdv = pricing
    ? decimalAt(pricing.startFdv, "$.pricing.startFdv", issues, false)
    : undefined;
  const migrationPrice = pricing
    ? decimalAt(pricing.migrationPrice, "$.pricing.migrationPrice", issues, false)
    : undefined;
  const migrationFdv = pricing
    ? decimalAt(pricing.migrationFdv, "$.pricing.migrationFdv", issues, false)
    : undefined;
  checkPair(startPrice, startFdv, "startPrice", "startFdv", "$.pricing", issues);
  checkPair(migrationPrice, migrationFdv, "migrationPrice", "migrationFdv", "$.pricing", issues);
  checkPairConsistency(startPrice, startFdv, totalBase, "startPrice", "startFdv", issues);
  checkPairConsistency(
    migrationPrice,
    migrationFdv,
    totalBase,
    "migrationPrice",
    "migrationFdv",
    issues,
  );
  for (const [name, value] of [
    ["startPrice", startPrice],
    ["startFdv", startFdv],
    ["migrationPrice", migrationPrice],
    ["migrationFdv", migrationFdv],
  ] as const) {
    if (value?.value.isZero()) {
      addIssue(issues, `$.pricing.${name}`, "must_be_positive", "Value must be greater than zero");
    }
  }
  const resolvedStartPrice = resolvePairPrice(startPrice, startFdv, totalBase);
  const resolvedMigrationPrice = resolvePairPrice(migrationPrice, migrationFdv, totalBase);
  if (
    resolvedStartPrice?.gt(0) &&
    resolvedMigrationPrice?.gt(0) &&
    resolvedMigrationPrice.lte(resolvedStartPrice)
  ) {
    addIssue(
      issues,
      migrationPrice ? "$.pricing.migrationPrice" : "$.pricing.migrationFdv",
      "migration_not_above_start",
      "Migration price must be greater than start price for an increasing curve",
    );
  }

  const targets = requiredRecord(root, "targets", "$.targets", issues);
  if (targets) checkKeys(targets, ["quoteToMigration", "baseDistributionPct"], "$.targets", issues);
  const quoteToMigration = targets
    ? decimalAt(targets.quoteToMigration, "$.targets.quoteToMigration", issues, false)
    : undefined;
  if (quoteToMigration?.value.isZero()) {
    addIssue(
      issues,
      "$.targets.quoteToMigration",
      "must_be_positive",
      "Value must be greater than zero",
    );
  }
  const parsedQuoteTarget =
    quoteToMigration && quote
      ? atomicAt(quoteToMigration, quote.decimals, "$.targets.quoteToMigration", issues)
      : undefined;
  const baseDistribution = targets
    ? percentAt(targets.baseDistributionPct, "$.targets.baseDistributionPct", issues)
    : undefined;

  const preferencesRecord = optionalRecord(root, "preferences", "$.preferences", issues);
  if (preferencesRecord) {
    checkKeys(
      preferencesRecord,
      ["launchProfile", "maxEarlyPriceImpactPct", "earlyBuyerAdvantagePct", "sniperResistance"],
      "$.preferences",
      issues,
    );
  }
  const launchProfile = enumAt(
    preferencesRecord?.launchProfile,
    "$.preferences.launchProfile",
    ["deep", "balanced", "momentum"],
    issues,
  );
  const sniperResistance = enumAt(
    preferencesRecord?.sniperResistance,
    "$.preferences.sniperResistance",
    ["low", "medium", "high"],
    issues,
  );
  const maxEarlyPriceImpact = preferencesRecord
    ? percentAt(
        preferencesRecord.maxEarlyPriceImpactPct,
        "$.preferences.maxEarlyPriceImpactPct",
        issues,
      )
    : undefined;
  const earlyBuyerAdvantage = preferencesRecord
    ? percentAt(
        preferencesRecord.earlyBuyerAdvantagePct,
        "$.preferences.earlyBuyerAdvantagePct",
        issues,
      )
    : undefined;

  const solverRecord = optionalRecord(root, "solver", "$.solver", issues);
  if (solverRecord) checkKeys(solverRecord, ["maxSegments"], "$.solver", issues);
  const maxSegments =
    solverRecord?.maxSegments === undefined
      ? DEFAULT_SOLVER_SEGMENT_COUNT
      : solverRecord.maxSegments;
  if (
    typeof maxSegments !== "number" ||
    !Number.isInteger(maxSegments) ||
    maxSegments < 1 ||
    maxSegments > MAX_SEGMENTS
  ) {
    addIssue(
      issues,
      "$.solver.maxSegments",
      "out_of_range",
      `Must be an integer from 1 to ${MAX_SEGMENTS}`,
    );
  }

  const migrationRecord = optionalRecord(root, "migration", "$.migration", issues);
  if (migrationRecord) {
    checkKeys(
      migrationRecord,
      ["creatorLockedPct", "partnerLockedPct", "unlockedPct", "lockDurationSeconds"],
      "$.migration",
      issues,
    );
  }
  const creatorLocked = migrationRecord
    ? percentAt(migrationRecord.creatorLockedPct, "$.migration.creatorLockedPct", issues)
    : undefined;
  const partnerLocked = migrationRecord
    ? percentAt(migrationRecord.partnerLockedPct, "$.migration.partnerLockedPct", issues)
    : undefined;
  const unlocked = migrationRecord
    ? percentAt(migrationRecord.unlockedPct, "$.migration.unlockedPct", issues)
    : undefined;
  const allocationValues = [creatorLocked, partnerLocked, unlocked];
  const anyAllocation = allocationValues.some((value) => value !== undefined);
  let lockDurationSeconds: bigint | undefined;
  if (migrationRecord?.lockDurationSeconds !== undefined) {
    const seconds = migrationRecord.lockDurationSeconds;
    if (typeof seconds !== "string" || seconds.length > 8 || !/^(0|[1-9]\d*)$/.test(seconds)) {
      addIssue(
        issues,
        "$.migration.lockDurationSeconds",
        "invalid_integer",
        "Must be a non-negative integer string",
      );
    } else {
      lockDurationSeconds = BigInt(seconds);
      if (lockDurationSeconds === 0n || lockDurationSeconds > MAX_LOCK_DURATION_SECONDS) {
        addIssue(
          issues,
          "$.migration.lockDurationSeconds",
          "out_of_range",
          "Must be greater than zero and no more than 63072000 seconds",
        );
      }
    }
  }
  if (anyAllocation) {
    if (allocationValues.some((value) => value === undefined)) {
      addIssue(
        issues,
        "$.migration",
        "incomplete_allocation",
        "Provide all three migration allocation percentages",
      );
    } else if (
      allocationValues.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n) !== 10_000n
    ) {
      addIssue(
        issues,
        "$.migration",
        "allocation_sum",
        "Migration allocation percentages must sum to 100%",
      );
    } else if ((creatorLocked ?? 0n) + (partnerLocked ?? 0n) < 1_000n) {
      addIssue(
        issues,
        "$.migration",
        "minimum_locked_allocation",
        "At least 10% must be locked on day one",
      );
    }
  }

  if (issues.length > 0) return { status: "invalid", issues };
  if (
    !base ||
    !quote ||
    !totalBase ||
    !parsedBase ||
    (!startPrice && !startFdv) ||
    (!migrationPrice && !migrationFdv)
  ) {
    return {
      status: "invalid",
      issues: [{ path: "$", code: "invalid_intent", message: "Intent could not be normalized" }],
    };
  }

  const quoteToMigrationAtomic = parsedQuoteTarget?.raw;

  const totalBaseHuman = new ExactDecimal(totalBase.text);
  const startValues = derivePair(startPrice, startFdv, totalBaseHuman);
  const migrationValues = derivePair(migrationPrice, migrationFdv, totalBaseHuman);
  const intent = input as MarketIntent;
  const normalized: NormalizedMarketIntent = {
    assets: { base, quote },
    baseDecimals: base.decimals,
    quoteDecimals: quote.decimals,
    totalBaseAtomic: parsedBase.raw,
    startPrice: startValues.price,
    startFdv: startValues.fdv,
    migrationPrice: migrationValues.price,
    migrationFdv: migrationValues.fdv,
    ...(quoteToMigrationAtomic === undefined ? {} : { quoteToMigrationAtomic }),
    ...(baseDistribution === undefined ? {} : { targetBaseDistributionBps: baseDistribution }),
    ...(launchProfile === undefined ? {} : { launchProfile }),
    ...(maxEarlyPriceImpact === undefined ? {} : { maxEarlyPriceImpactBps: maxEarlyPriceImpact }),
    ...(earlyBuyerAdvantage === undefined ? {} : { earlyBuyerAdvantageBps: earlyBuyerAdvantage }),
    ...(sniperResistance === undefined ? {} : { sniperResistance }),
    maxSegments: maxSegments as number,
    ...(migrationRecord === undefined
      ? {}
      : {
          migration: {
            ...(creatorLocked === undefined ? {} : { creatorLockedBps: creatorLocked }),
            ...(partnerLocked === undefined ? {} : { partnerLockedBps: partnerLocked }),
            ...(unlocked === undefined ? {} : { unlockedBps: unlocked }),
            ...(lockDurationSeconds === undefined ? {} : { lockDurationSeconds }),
          },
        }),
  };
  return { status: "valid", intent, normalized };
}

function recordAt(
  value: unknown,
  path: string,
  issues: MarketIntentIssue[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_object", "Expected an object");
    return undefined;
  }
  return value;
}

function requiredRecord(
  parent: UnknownRecord,
  key: string,
  path: string,
  issues: MarketIntentIssue[],
): UnknownRecord | undefined {
  return recordAt(parent[key], path, issues);
}

function optionalRecord(
  parent: UnknownRecord,
  key: string,
  path: string,
  issues: MarketIntentIssue[],
): UnknownRecord | undefined {
  return parent[key] === undefined ? undefined : recordAt(parent[key], path, issues);
}

function parseAsset(
  input: UnknownRecord,
  path: string,
  baseAsset: boolean,
  issues: MarketIntentIssue[],
): AssetDefinition | undefined {
  checkKeys(input, ["symbol", "decimals", "mint"], path, issues);
  const symbol = input.symbol;
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    addIssue(issues, `${path}.symbol`, "invalid_symbol", "Symbol must be a non-empty string");
  }
  const decimals = input.decimals;
  const maxDecimals = baseAsset ? 9 : 255;
  const minDecimals = baseAsset ? 6 : 0;
  if (
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < minDecimals ||
    decimals > maxDecimals
  ) {
    addIssue(
      issues,
      `${path}.decimals`,
      "out_of_range",
      `Must be an integer from ${minDecimals} to ${maxDecimals}`,
    );
  }
  const mint = input.mint;
  if (mint !== undefined && (typeof mint !== "string" || mint.trim().length === 0)) {
    addIssue(
      issues,
      `${path}.mint`,
      "invalid_mint",
      "Mint must be a non-empty string when provided",
    );
  }
  if (typeof symbol !== "string" || typeof decimals !== "number" || !Number.isInteger(decimals))
    return undefined;
  return {
    symbol: symbol.trim(),
    decimals,
    ...(typeof mint === "string" ? { mint: mint.trim() } : {}),
  };
}

function decimalAt(
  input: unknown,
  path: string,
  issues: MarketIntentIssue[],
  required: boolean,
): DecimalEntry | undefined {
  if (input === undefined) {
    if (required) addIssue(issues, path, "required", "Value is required");
    return undefined;
  }
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_DECIMAL_LENGTH ||
    !/^\d+(?:\.\d+)?$/.test(input)
  ) {
    addIssue(
      issues,
      path,
      "invalid_decimal",
      `Must be a plain non-negative decimal string up to ${MAX_DECIMAL_LENGTH} characters`,
    );
    return undefined;
  }
  return { value: new ExactDecimal(input), text: input };
}

function percentAt(input: unknown, path: string, issues: MarketIntentIssue[]): bigint | undefined {
  const entry = decimalAt(input, path, issues, false);
  if (!entry) return undefined;
  if (entry.value.gt(100)) {
    addIssue(issues, path, "out_of_range", "Percentage must be between 0 and 100");
    return undefined;
  }
  const basisPoints = entry.value.mul(100);
  if (!basisPoints.isInteger()) {
    addIssue(issues, path, "precision", "Percentage must have no more than two fractional digits");
    return undefined;
  }
  return BigInt(basisPoints.toFixed(0));
}

function atomicAt(
  input: DecimalEntry,
  decimals: number,
  path: string,
  issues: MarketIntentIssue[],
): Readonly<{ raw: bigint }> | undefined {
  try {
    return parseCurrencyAmount(input.text, decimals);
  } catch {
    addIssue(
      issues,
      path,
      "precision",
      `Amount is not exactly representable with ${decimals} decimals`,
    );
    return undefined;
  }
}

function checkPair(
  price: DecimalEntry | undefined,
  fdv: DecimalEntry | undefined,
  priceName: string,
  fdvName: string,
  path: string,
  issues: MarketIntentIssue[],
): void {
  if (!price && !fdv) {
    addIssue(
      issues,
      `${path}.${priceName}`,
      "required_alternative",
      `Provide ${priceName} or ${fdvName}`,
    );
  }
}

function checkPairConsistency(
  price: DecimalEntry | undefined,
  fdv: DecimalEntry | undefined,
  totalBase: DecimalEntry | undefined,
  priceName: string,
  fdvName: string,
  issues: MarketIntentIssue[],
): void {
  if (price && fdv && totalBase && !price.value.mul(totalBase.value).eq(fdv.value)) {
    addIssue(
      issues,
      `$.pricing.${priceName}`,
      "inconsistent_pair",
      `${priceName} and ${fdvName} do not agree with total base supply`,
    );
  }
}

function derivePair(
  price: DecimalEntry | undefined,
  fdv: DecimalEntry | undefined,
  totalBase: Decimal,
): Readonly<{ price: Decimal; fdv: Decimal }> {
  if (price && fdv) return { price: new ExactDecimal(price.text), fdv: new ExactDecimal(fdv.text) };
  if (fdv)
    return { price: new ExactDecimal(fdv.text).div(totalBase), fdv: new ExactDecimal(fdv.text) };
  if (!price) throw new Error("Price or FDV must be provided");
  const resolvedPrice = new ExactDecimal(price.text);
  return { price: resolvedPrice, fdv: resolvedPrice.mul(totalBase) };
}

function resolvePairPrice(
  price: DecimalEntry | undefined,
  fdv: DecimalEntry | undefined,
  totalBase: DecimalEntry | undefined,
): Decimal | undefined {
  if (price) return price.value;
  if (!fdv || !totalBase || !totalBase.value.gt(0)) return undefined;
  return fdv.value.div(totalBase.value);
}

function enumAt<const T extends readonly string[]>(
  input: unknown,
  path: string,
  values: T,
  issues: MarketIntentIssue[],
): T[number] | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !values.includes(input)) {
    addIssue(issues, path, "invalid_value", `Must be one of: ${values.join(", ")}`);
    return undefined;
  }
  return input as T[number];
}

function checkKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: MarketIntentIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      addIssue(issues, `${path}.${key}`, "unknown_field", "Field is not supported");
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: MarketIntentIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}
