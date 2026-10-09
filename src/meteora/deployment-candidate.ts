import { createHash } from "node:crypto";
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  calculateLockedLiquidityBpsAtTime,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  fromDecimalToBN,
  getBaseTokenForSwap,
  getLockedVestingParams,
  getMigrationBaseToken,
  getMigrationQuoteAmountFromMigrationQuoteThreshold,
  getMigrationThresholdPrice,
  getSwapAmountWithBuffer,
  getTotalSupplyFromCurve,
  getTotalTokenSupply,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  SECONDS_PER_DAY,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  bpsToFeeNumerator,
  validateConfigParameters,
  validateCurve,
  validateMinimumLockedLiquidity,
  type ConfigParameters,
  type LiquidityDistributionParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { CompileDraftCandidate, CliCompileReport } from "../cli/compile.js";
import { compileDocument } from "../cli/compile.js";
import { convertConfigBigintStrings } from "../cli/validate.js";
import { validateMigrationConfiguration } from "../domain/configuration-validation.js";
import type { MigrationConfiguration } from "../domain/migration.js";
import { validateDbcCurveShape, type DbcCurve } from "../domain/curve.js";
import type { ConfigurationValidationIssue } from "../domain/configuration-validation.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import {
  type CompleteSdkConfigCandidate,
  validateCompleteSdkConfigCandidate,
} from "./complete-config-validation.js";
import {
  type MeteoraMarketTransactionBuildResult,
  buildMeteoraMarketTransaction,
} from "./deployment-market-builder.js";

export const DEMO_V1_METADATA_URI_PLACEHOLDER = "DEVNET_METADATA_URI_REQUIRED";
const DEMO_V1_QUOTE_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEMO_V1_METADATA_ASSET_PATH = "examples/devnet-token-metadata.json";
const BASE_TOKEN_ATOMIC_SCALE = 1_000_000_000n;
const DEMO_V1_OBJECTIVE_WEIGHTS = {
  quoteError: "0.35",
  distributionError: "0.35",
  migrationPriceError: "0.1",
  earlyPriceImpact: "0",
  attackProfitability: "0",
  complexity: "0.2",
} as const;

export type CompiledMarket = Readonly<{
  marketIntent: unknown;
  objectiveWeights: unknown;
  simulationConfiguration: unknown;
  deploymentConfiguration: Readonly<{
    baseToken: Readonly<{
      name: string;
      symbol: string;
      decimals: 9;
      supplyMode: "fixed";
      totalSupply: string;
    }>;
    quoteToken: Readonly<{
      symbol: string;
      decimals: 6;
      mint: string;
      liveVerification: "required-before-transaction-preflight";
    }>;
    poolCreationFeeLamports: string;
  }>;
  candidate: CompileDraftCandidate;
  solverStatus: "satisfied" | "partial";
  engineVersion: string;
  algorithmVersion: string;
  sdkVersion: string;
}>;

export type DeploymentCandidate = Readonly<{
  schemaVersion: 1;
  profileId: "demo-v1";
  network: "devnet";
  market: CompiledMarket;
  migration: MigrationConfiguration;
  authority: Readonly<{
    mode: "runtime-deployer";
    publicKey?: string;
  }>;
  metadata: Readonly<{
    uri: string;
    status: "unresolved" | "resolved";
    assetPath: string;
  }>;
  sdkConfig: ConfigParameters;
  sdkValidation: Readonly<{
    sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
    configurationParameters: "accepted-with-runtime-receiver-deferred";
    fixedSupplyBounds: "accepted-by-pinned-sdk-helpers";
    runtimeReceiver: "deployer-wallet-required-at-transaction-validation";
    minimumPreMigrationSupplyAtomic: string;
    minimumPostMigrationSupplyAtomic: string;
    derivedLeftoverAtomic: string;
    sdkBuilderLeftoverTokenUnits: string;
    dayOneLockedLiquidityBps: number;
  }>;
  assumptions: readonly string[];
}>;

export type DeploymentCandidateResult =
  | Readonly<{ status: "complete"; candidate: DeploymentCandidate }>
  | Readonly<{ status: "invalid"; issues: readonly ConfigurationValidationIssue[] }>;

export type PreparedDeployment = Readonly<{
  status: "prepared";
  candidate: DeploymentCandidate;
  serializedCandidate: string;
  candidateDigestHex: string;
}>;

export type PrepareDeploymentResult =
  | PreparedDeployment
  | Readonly<{ status: "blocked"; issues: readonly ConfigurationValidationIssue[] }>;

export type DeploymentSendContext = Readonly<{
  candidate: DeploymentCandidate;
  connectedWalletPublicKey: string;
  rpcEndpoint: string;
  genesisHash: string;
  transactionMessageDigestHex: string;
  preflight: Readonly<{ status: "sufficient" | "failed"; messageDigestHex: string }>;
  simulation: Readonly<{ status: "succeeded" | "rejected"; messageDigestHex: string }>;
  approval: Readonly<{
    status: "approved" | "rejected" | "pending";
    approverAddress: string;
    messageDigestHex: string;
  }>;
}>;

export type DeploymentSendResult =
  | Readonly<{
      status: "ready";
      candidateId: string;
      walletAddress: string;
      messageDigestHex: string;
      broadcast: "not-invoked";
    }>
  | Readonly<{
      status: "blocked";
      reasons: readonly (
        | "candidate-incomplete"
        | "wallet-unresolved"
        | "wallet-mismatch"
        | "metadata-unresolved"
        | "devnet-unconfirmed"
        | "preflight-incomplete"
        | "simulation-incomplete"
        | "approval-required"
        | "approval-rejected"
        | "approval-mismatch"
      )[];
    }>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): ConfigurationValidationIssue {
  return { path, code, message };
}

function bigintString(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function wholeNumber(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function sdkBn(value: bigint | string): ReturnType<typeof fromDecimalToBN> {
  return fromDecimalToBN(new Decimal(value.toString()));
}

function restoreSerializedSdkIntegers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreSerializedSdkIntegers);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return sdkBn(value);
  if (!isRecord(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, restoreSerializedSdkIntegers(child)]),
  );
}

function restoreSerializedCurveIntegers(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const asBigint = (candidate: unknown) =>
    typeof candidate === "string" && /^(0|[1-9][0-9]*)$/.test(candidate)
      ? BigInt(candidate)
      : candidate;
  return {
    ...value,
    startSqrtPriceQ64x64: asBigint(value.startSqrtPriceQ64x64),
    migrationQuoteThresholdAtomic: asBigint(value.migrationQuoteThresholdAtomic),
    segments: Array.isArray(value.segments)
      ? value.segments.map((segment) =>
          isRecord(segment)
            ? {
                ...segment,
                lowerSqrtPriceQ64x64: asBigint(segment.lowerSqrtPriceQ64x64),
                upperSqrtPriceQ64x64: asBigint(segment.upperSqrtPriceQ64x64),
                liquidity: asBigint(segment.liquidity),
              }
            : segment,
        )
      : value.segments,
  };
}

function safeSdkInteger(value: unknown): bigint | undefined {
  if (typeof value !== "object" || value === null || typeof value.toString !== "function")
    return undefined;
  try {
    const text = String(value);
    return /^(0|[1-9][0-9]*)$/.test(text) ? BigInt(text) : undefined;
  } catch {
    return undefined;
  }
}

function parseProfile(
  input: unknown,
):
  | Readonly<{ status: "valid"; value: UnknownRecord; migration: MigrationConfiguration }>
  | Readonly<{ status: "invalid"; issues: readonly ConfigurationValidationIssue[] }> {
  if (!isRecord(input)) {
    return {
      status: "invalid",
      issues: [issue("$", "invalid_demo_profile", "A demo profile is required.")],
    };
  }
  if (
    input.profileId !== "demo-v1" ||
    input.schemaVersion !== 1 ||
    input.network !== "devnet" ||
    input.classification !== "seeded-devnet-demo-only"
  ) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$",
          "unsupported_demo_profile",
          "Only version 1 of the seeded demo-v1 Devnet profile is supported.",
        ),
      ],
    };
  }
  let migrationValue: unknown;
  try {
    migrationValue = convertConfigBigintStrings(input.migration, "$.migration");
  } catch {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.migration",
          "invalid_migration_integer",
          "Migration fields must use valid decimal integer strings.",
        ),
      ],
    };
  }
  const migration = validateMigrationConfiguration(migrationValue);
  if (migration.status === "invalid") {
    return { status: "invalid", issues: migration.issues };
  }
  if (!isDemoV1Migration(migration.value)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.migration",
          "seeded_migration_values_changed",
          "The demo-v1 migration economics must match the seeded profile values.",
        ),
      ],
    };
  }
  if (!Array.isArray(input.assumptions) || input.assumptions.length === 0) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.assumptions",
          "profile_assumptions_required",
          "Profile assumptions must be explicit.",
        ),
      ],
    };
  }
  return { status: "valid", value: input, migration: migration.value };
}

function isDemoV1Migration(migration: MigrationConfiguration): boolean {
  const allocation = migration.liquidityAllocation;
  const intent = migration.allocationIntent;
  const fee = migration.fee;
  const poolFee = migration.migratedPoolFee;
  return (
    migration.destination === "damm-v2" &&
    fee?.feeBps === 1_000n &&
    fee.creatorFeeShareBps === 5_000n &&
    intent?.creatorLockedBps === 500n &&
    intent.partnerLockedBps === 500n &&
    intent.unlockedBps === 9_000n &&
    intent.lockDurationSeconds === 86_400n &&
    allocation?.creator.unlockedBps === 2_000n &&
    allocation.creator.permanentlyLockedBps === 1_000n &&
    allocation.creator.vestingBps === 2_000n &&
    allocation.partner.unlockedBps === 2_000n &&
    allocation.partner.permanentlyLockedBps === 1_000n &&
    allocation.partner.vestingBps === 2_000n &&
    poolFee?.feeBps === 100n &&
    poolFee.collectFeeMode === "compounding" &&
    poolFee.dynamicFeeEnabled === false &&
    poolFee.compoundingFeeBps === 500n
  );
}

function isDemoV1MarketIntent(value: unknown): boolean {
  const result = validateMarketIntent(value);
  if (result.status !== "valid") return false;
  const intent = result.normalized;
  return (
    intent.assets.base.symbol === "MKT" &&
    intent.assets.quote.symbol === "USDC" &&
    intent.baseDecimals === 9 &&
    intent.quoteDecimals === 6 &&
    intent.totalBaseAtomic === 1_000_000_000_000_000_000n &&
    intent.startFdv.comparedTo("200000") === 0 &&
    intent.migrationFdv.comparedTo("2000000") === 0 &&
    intent.quoteToMigrationAtomic === 150_000_000_000n &&
    intent.targetBaseDistributionBps === 2_500n &&
    intent.launchProfile === "balanced" &&
    intent.sniperResistance === "high" &&
    intent.maxSegments === 3
  );
}

function isDemoV1ObjectiveWeights(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const expectedKeys = Object.keys(DEMO_V1_OBJECTIVE_WEIGHTS);
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every(
      (key) =>
        value[key] === DEMO_V1_OBJECTIVE_WEIGHTS[key as keyof typeof DEMO_V1_OBJECTIVE_WEIGHTS],
    )
  );
}

function isDemoV1SimulationConfiguration(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fees = isRecord(value.fees) ? value.fees : undefined;
  const baseFee = fees && isRecord(fees.base) ? fees.base : undefined;
  const clock = isRecord(value.clock) ? value.clock : undefined;
  const migration = isRecord(value.migration) ? value.migration : undefined;
  return (
    value.supplyMode === "fixed" &&
    value.activationPoint === "0" &&
    value.activationType === "slot" &&
    clock?.slot === "0" &&
    clock.timestampSeconds === "0" &&
    fees?.collectFeeMode === "quote" &&
    fees.creatorTradingFeeShareBps === "2500" &&
    baseFee?.kind === "fixed" &&
    baseFee.feeBps === "25" &&
    migration?.destination === "damm-v2"
  );
}

function profileFields(profile: UnknownRecord, compileRequest: unknown) {
  const issues: ConfigurationValidationIssue[] = [];
  const market = isRecord(profile.market) ? profile.market : undefined;
  const base = market && isRecord(market.baseToken) ? market.baseToken : undefined;
  const quote = market && isRecord(market.quoteToken) ? market.quoteToken : undefined;
  const baseTokenVesting =
    market && isRecord(market.baseTokenVesting) ? market.baseTokenVesting : undefined;
  const metadata = isRecord(profile.metadata) ? profile.metadata : undefined;
  const vesting = isRecord(profile.liquidityVestingSchedule)
    ? profile.liquidityVestingSchedule
    : undefined;
  const sdkMapping = isRecord(profile.sdkMapping) ? profile.sdkMapping : undefined;
  const marketCapFeeScheduler =
    sdkMapping && isRecord(sdkMapping.marketCapFeeScheduler)
      ? sdkMapping.marketCapFeeScheduler
      : undefined;
  const runtimeBindings = isRecord(profile.runtimeBindings) ? profile.runtimeBindings : undefined;
  const compileMarket =
    isRecord(compileRequest) && isRecord(compileRequest.marketIntent)
      ? validateMarketIntent(compileRequest.marketIntent)
      : undefined;
  const supply =
    compileMarket?.status === "valid" ? compileMarket.normalized.totalBaseAtomic : undefined;
  const profileSupply = bigintString(base?.totalSupply);

  if (market?.compileRequest !== "demo-compile-request.json") {
    issues.push(
      issue(
        "$.market.compileRequest",
        "unsupported_demo_compile_request",
        "demo-v1 must use the tracked deterministic compile request.",
      ),
    );
  }
  if (
    !market ||
    !base ||
    !quote ||
    !metadata ||
    !vesting ||
    !runtimeBindings ||
    !sdkMapping ||
    !marketCapFeeScheduler
  ) {
    issues.push(
      issue("$", "demo_profile_fields_missing", "The seeded Devnet profile is incomplete."),
    );
  }
  if (
    base?.type !== "spl-token" ||
    base.authorityMode !== "runtime-deployer" ||
    base.tokenUpdateAuthority !== "creator-update-authority"
  ) {
    issues.push(
      issue(
        "$.market.baseToken.authorityMode",
        "invalid_runtime_authority",
        "The demo profile must resolve creator update authority from the runtime deployer wallet.",
      ),
    );
  }
  if (
    !base ||
    typeof base.name !== "string" ||
    typeof base.symbol !== "string" ||
    base.name !== "Tymba Devnet Demo" ||
    base.symbol !== "MKT" ||
    !wholeNumber(base.decimals, 9) ||
    base.decimals !== 9 ||
    base.supplyMode !== "fixed" ||
    base.leftoverPolicy !== "derive-from-pinned-sdk-minimum-with-buffer"
  ) {
    issues.push(
      issue(
        "$.market.baseToken",
        "invalid_demo_base_token",
        "The demo base-token profile is invalid.",
      ),
    );
  }
  if (
    !quote ||
    quote.symbol !== "USDC" ||
    quote.decimals !== 6 ||
    quote.mint !== DEMO_V1_QUOTE_MINT ||
    !validPublicAddress(quote.mint) ||
    quote.liveVerification !== "required-before-transaction-preflight"
  ) {
    issues.push(
      issue(
        "$.market.quoteToken",
        "invalid_demo_quote_token",
        "The demo quote-token profile is invalid.",
      ),
    );
  }
  if (
    market?.activationType !== "slot" ||
    market.poolCreationFeeLamports !== "0" ||
    market.enableFirstSwapWithMinFee !== false
  ) {
    issues.push(
      issue(
        "$.market",
        "unsupported_demo_market_settings",
        "The seeded market settings do not match demo-v1.",
      ),
    );
  }
  if (
    !baseTokenVesting ||
    baseTokenVesting.totalLockedVestingAmount !== "0" ||
    baseTokenVesting.numberOfVestingPeriod !== 0 ||
    baseTokenVesting.cliffUnlockAmount !== "0" ||
    baseTokenVesting.totalVestingDurationSeconds !== "0" ||
    baseTokenVesting.cliffDurationFromMigrationTimeSeconds !== "0"
  ) {
    issues.push(
      issue(
        "$.market.baseTokenVesting",
        "unsupported_demo_base_vesting",
        "demo-v1 keeps base-token vesting disabled.",
      ),
    );
  }
  if (
    sdkMapping?.migrationFeeOption !== "customizable" ||
    sdkMapping.migratedPoolBaseFeeMode !== "fee-time-scheduler-linear" ||
    marketCapFeeScheduler?.endingBaseFeeBps !== 100 ||
    marketCapFeeScheduler.numberOfPeriod !== 0 ||
    marketCapFeeScheduler.priceMultiple !== 0 ||
    marketCapFeeScheduler.schedulerExpirationDuration !== 0
  ) {
    issues.push(
      issue(
        "$.sdkMapping",
        "unsupported_sdk_migration_mapping",
        "The explicit seeded DAMM v2 fee mapping is invalid.",
      ),
    );
  }
  if (
    !metadata ||
    metadata.uri !== DEMO_V1_METADATA_URI_PLACEHOLDER ||
    metadata.status !== "unresolved" ||
    metadata.assetPath !== DEMO_V1_METADATA_ASSET_PATH
  ) {
    issues.push(
      issue(
        "$.metadata",
        "invalid_demo_metadata_profile",
        "The local metadata asset must remain explicitly unresolved.",
      ),
    );
  }
  const vestingDuration = bigintString(vesting?.durationSeconds);
  const sourceLockDuration =
    isRecord(profile.migration) && isRecord(profile.migration.allocationIntent)
      ? bigintString(profile.migration.allocationIntent.lockDurationSeconds)
      : undefined;
  if (
    !vesting ||
    vestingDuration !== 86_400n ||
    sourceLockDuration !== vestingDuration ||
    vesting.cliffDurationFromMigrationTimeSeconds !== "0" ||
    vesting.periodCount !== 1 ||
    vesting.bpsPerPeriod !== "10000" ||
    vesting.basis !== "migration.allocationIntent.lockDurationSeconds"
  ) {
    issues.push(
      issue(
        "$.liquidityVestingSchedule",
        "invalid_demo_vesting_assumption",
        "The one-release demo vesting assumption is invalid.",
      ),
    );
  }
  const requiredRoles = [
    "payer",
    "poolCreator",
    "feeClaimer",
    "leftoverReceiver",
    "creatorUpdateAuthority",
  ];
  const deployerWalletFor =
    runtimeBindings && Array.isArray(runtimeBindings.deployerWalletFor)
      ? runtimeBindings.deployerWalletFor
      : [];
  if (
    runtimeBindings?.authorityMode !== "runtime-deployer" ||
    runtimeBindings.configAndBaseMintSigners !== "generated-at-runtime-and-held-in-memory" ||
    requiredRoles.some((role) => !deployerWalletFor.includes(role))
  ) {
    issues.push(
      issue(
        "$.runtimeBindings",
        "invalid_runtime_role_bindings",
        "All demo wallet roles must resolve from the connected deployer.",
      ),
    );
  }
  if (compileMarket?.status !== "valid") {
    issues.push(
      issue("$.market", "invalid_compile_intent", "The seeded market intent is invalid."),
    );
  } else {
    if (
      compileMarket.normalized.baseDecimals !== base?.decimals ||
      compileMarket.normalized.quoteDecimals !== quote?.decimals ||
      compileMarket.normalized.assets.base.symbol !== base?.symbol ||
      compileMarket.normalized.assets.quote.symbol !== quote?.symbol ||
      compileMarket.normalized.totalBaseAtomic === undefined ||
      compileMarket.normalized.startFdv.comparedTo("200000") !== 0 ||
      compileMarket.normalized.migrationFdv.comparedTo("2000000") !== 0 ||
      compileMarket.normalized.quoteToMigrationAtomic !== 150_000_000_000n ||
      compileMarket.normalized.targetBaseDistributionBps !== 2_500n ||
      compileMarket.normalized.launchProfile !== "balanced" ||
      compileMarket.normalized.sniperResistance !== "high" ||
      compileMarket.normalized.maxSegments !== 3 ||
      profileSupply === undefined ||
      supply !== profileSupply * BASE_TOKEN_ATOMIC_SCALE
    ) {
      issues.push(
        issue(
          "$.market",
          "compile_profile_mismatch",
          "The compile request and deployment profile must describe the same assets and supply.",
        ),
      );
    }
  }
  const compileRecord = isRecord(compileRequest) ? compileRequest : undefined;
  const simulation =
    compileRecord && isRecord(compileRecord.simulation) ? compileRecord.simulation : undefined;
  const clock = simulation && isRecord(simulation.clock) ? simulation.clock : undefined;
  const simFees = simulation && isRecord(simulation.fees) ? simulation.fees : undefined;
  const simBaseFee = simFees && isRecord(simFees.base) ? simFees.base : undefined;
  const compileMigration =
    simulation && isRecord(simulation.migration) ? simulation.migration : undefined;
  const objectiveWeights =
    compileRecord && isRecord(compileRecord.objectiveWeights)
      ? compileRecord.objectiveWeights
      : undefined;
  const creatorFeeShare = simFees?.creatorTradingFeeShareBps;
  if (
    !simulation ||
    compileRecord?.earlyPriceImpactProbeQuoteAtomic !== undefined ||
    simulation.supplyMode !== "fixed" ||
    simulation.activationPoint !== "0" ||
    simulation.activationType !== market?.activationType ||
    clock?.slot !== "0" ||
    clock.timestampSeconds !== "0" ||
    simFees?.collectFeeMode !== "quote" ||
    simBaseFee?.kind !== "fixed" ||
    simBaseFee.feeBps !== "25" ||
    creatorFeeShare !== "2500" ||
    !isDemoV1ObjectiveWeights(objectiveWeights) ||
    !isDemoV1SimulationConfiguration(simulation) ||
    compileMigration?.destination !== "damm-v2"
  ) {
    issues.push(
      issue(
        "$.market",
        "compile_profile_settings_mismatch",
        "The compile request settings must match the seeded SDK profile.",
      ),
    );
  }
  return {
    issues,
    market,
    base,
    quote,
    metadata,
    vesting,
    runtimeBindings,
    sdkMapping,
    marketCapFeeScheduler,
    supply,
  };
}

function wholeHumanAmount(value: unknown, path: string): number {
  const parsed = bigintString(value);
  if (parsed === undefined || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${path} must be a safe whole-token amount`);
  }
  const amount = Number(parsed);
  if (!Number.isSafeInteger(amount) || BigInt(amount) !== parsed) {
    throw new TypeError(`${path} must be a safe whole-token amount`);
  }
  return amount;
}

function exactBoundaryCurve(curve: DbcCurve): LiquidityDistributionParameters[] {
  return curve.segments.map((segment) => ({
    sqrtPrice: sdkBn(segment.upperSqrtPriceQ64x64),
    liquidity: sdkBn(segment.liquidity),
  }));
}

function validateSdkConfigurationWithoutRuntimeReceiver(sdkConfig: ConfigParameters): void {
  validateConfigParameters({
    ...sdkConfig,
    tokenSupply: undefined,
    leftoverReceiver: undefined,
  } as Parameters<typeof validateConfigParameters>[0]);
}

function validateFixedSupplyWithoutRuntimeReceiver(sdkConfig: ConfigParameters) {
  const preMigrationSupply = safeSdkInteger(sdkConfig.tokenSupply?.preMigrationTokenSupply);
  const postMigrationSupply = safeSdkInteger(sdkConfig.tokenSupply?.postMigrationTokenSupply);
  if (preMigrationSupply === undefined || postMigrationSupply === undefined) {
    throw new TypeError("Complete fixed-supply values are required");
  }
  const sqrtMigrationPrice = getMigrationThresholdPrice(
    sdkConfig.migrationQuoteThreshold,
    sdkConfig.sqrtStartPrice,
    sdkConfig.curve,
  );
  const swapBaseAmount = getBaseTokenForSwap(
    sdkConfig.sqrtStartPrice,
    sqrtMigrationPrice,
    sdkConfig.curve,
  );
  const migrationQuoteAmount = getMigrationQuoteAmountFromMigrationQuoteThreshold(
    new Decimal(sdkConfig.migrationQuoteThreshold.toString()),
    sdkConfig.migrationFee.feePercentage,
  );
  const migrationBaseAmount = getMigrationBaseToken(
    sdkBn(migrationQuoteAmount.toFixed()),
    sqrtMigrationPrice,
    sdkConfig.migrationOption,
  );
  const swapBaseAmountBuffer = getSwapAmountWithBuffer(
    swapBaseAmount,
    sdkConfig.sqrtStartPrice,
    sdkConfig.curve,
  );
  const minimumPostMigrationSupply = getTotalTokenSupply(
    swapBaseAmount,
    migrationBaseAmount,
    sdkConfig.lockedVesting,
  );
  const minimumPreMigrationSupply = getTotalTokenSupply(
    swapBaseAmountBuffer,
    migrationBaseAmount,
    sdkConfig.lockedVesting,
  );
  const minimumPre = safeSdkInteger(minimumPreMigrationSupply);
  const minimumPost = safeSdkInteger(minimumPostMigrationSupply);
  if (
    minimumPre === undefined ||
    minimumPost === undefined ||
    minimumPost > preMigrationSupply ||
    postMigrationSupply > preMigrationSupply ||
    minimumPost > postMigrationSupply ||
    minimumPre > preMigrationSupply
  ) {
    throw new RangeError("Fixed token supply does not cover the pinned SDK curve requirements");
  }
  const requiredWithBuffer = getTotalSupplyFromCurve(
    sdkConfig.migrationQuoteThreshold,
    sdkConfig.sqrtStartPrice,
    sdkConfig.curve,
    sdkConfig.lockedVesting,
    sdkConfig.migrationOption,
    sdkBn(0n),
    sdkConfig.migrationFee.feePercentage,
  );
  const requiredWithBufferAtomic = safeSdkInteger(requiredWithBuffer);
  if (requiredWithBufferAtomic === undefined || requiredWithBufferAtomic > preMigrationSupply) {
    throw new RangeError("Fixed token supply does not cover the pinned SDK pre-migration buffer");
  }
  return {
    minimumPreMigrationSupplyAtomic: minimumPre.toString(),
    minimumPostMigrationSupplyAtomic: minimumPost.toString(),
    derivedLeftoverAtomic: (preMigrationSupply - requiredWithBufferAtomic).toString(),
    sdkBuilderLeftoverTokenUnits: ceilDiv(
      preMigrationSupply - requiredWithBufferAtomic,
      BASE_TOKEN_ATOMIC_SCALE,
    ).toString(),
  };
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return value === 0n ? 0n : (value + divisor - 1n) / divisor;
}

function canonicalJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Decimal.isDecimal(value)) return value.toFixed();
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
  if (typeof value !== "object" || value === null) return value;
  if (value.constructor?.name === "BN" && typeof value.toString === "function") {
    return value.toString();
  }
  if (value.constructor?.name === "PublicKey" || value.constructor?.name === "Keypair") {
    throw new TypeError("Deployment candidates cannot serialize runtime keys or signing material");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Deployment candidate contains an unsupported value");
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  );
}

function sensitiveField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(sensitiveField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
    return (
      /privatekey|secret|mnemonic|seedphrase|keypair|signingmaterial/.test(normalized) ||
      sensitiveField(child)
    );
  });
}

export function serializeDeploymentCandidate(candidate: DeploymentCandidate): string {
  if (sensitiveField(candidate)) {
    throw new TypeError("Deployment candidates cannot contain secrets or signing material");
  }
  return JSON.stringify(canonicalJson(candidate), null, 2);
}

export function prepareDeployment(input: unknown): PrepareDeploymentResult {
  const validation = validateDeploymentCandidate(input);
  if (validation.status === "invalid") return { status: "blocked", issues: validation.issues };
  try {
    const serializedCandidate = serializeDeploymentCandidate(validation.candidate);
    const candidateDigestHex = createHash("sha256").update(serializedCandidate).digest("hex");
    return {
      status: "prepared",
      candidate: validation.candidate,
      serializedCandidate,
      candidateDigestHex,
    };
  } catch {
    return {
      status: "blocked",
      issues: [
        issue(
          "$",
          "candidate_serialization_failed",
          "The complete deployment candidate could not be serialized safely.",
        ),
      ],
    };
  }
}

export function buildCandidate(input: {
  compileRequest: unknown;
  profile: unknown;
  candidateId?: string;
}): DeploymentCandidateResult {
  const parsedProfile = parseProfile(input.profile);
  if (parsedProfile.status === "invalid") return parsedProfile;
  const fields = profileFields(parsedProfile.value, input.compileRequest);
  if (
    fields.issues.length > 0 ||
    !fields.base ||
    !fields.quote ||
    !fields.metadata ||
    !fields.vesting ||
    !fields.sdkMapping ||
    !fields.marketCapFeeScheduler
  ) {
    return { status: "invalid", issues: fields.issues };
  }
  const report = compileDocument(input.compileRequest);
  if (report.draftCandidates.length === 0 || !report.solverStatus) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.market",
          "compiled_market_unavailable",
          "A solver-compiled market is required for the deployment candidate.",
        ),
      ],
    };
  }
  const selected = selectCandidate(report, input.candidateId);
  if (!selected) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.market.candidateId",
          "compiled_candidate_unavailable",
          "The selected compiler candidate is not present in this request.",
        ),
      ],
    };
  }
  try {
    const baseFee = (input.compileRequest as UnknownRecord).simulation as UnknownRecord;
    const fees = baseFee.fees as UnknownRecord;
    const baseSchedule = fees.base as UnknownRecord;
    const creatorTradingFeeShareBps = fees.creatorTradingFeeShareBps as string;
    const totalSupply = wholeHumanAmount(fields.base.totalSupply, "market.baseToken.totalSupply");
    const exactCurve = selected.curve;
    const supplyInAtomic = fields.supply;
    if (supplyInAtomic === undefined) throw new TypeError("Market supply is missing");
    const migration = parsedProfile.migration;
    const allocation = migration.liquidityAllocation;
    const migrationFee = migration.fee;
    const migratedPoolFee = migration.migratedPoolFee;
    if (!allocation || !migrationFee || !migratedPoolFee)
      throw new TypeError("Migration profile is incomplete");
    const baseVesting = fields.market?.baseTokenVesting;
    if (!isRecord(baseVesting)) throw new TypeError("Base vesting profile is incomplete");
    const baseLockedAmount = wholeHumanAmount(
      baseVesting.totalLockedVestingAmount,
      "market.baseTokenVesting.totalLockedVestingAmount",
    );
    const baseCliffUnlock = wholeHumanAmount(
      baseVesting.cliffUnlockAmount,
      "market.baseTokenVesting.cliffUnlockAmount",
    );
    const baseNumberPeriods = wholeNumber(baseVesting.numberOfVestingPeriod, 65_535)
      ? baseVesting.numberOfVestingPeriod
      : Number.NaN;
    const baseTotalDuration = wholeHumanAmount(
      baseVesting.totalVestingDurationSeconds,
      "market.baseTokenVesting.totalVestingDurationSeconds",
    );
    const baseCliffDuration = wholeHumanAmount(
      baseVesting.cliffDurationFromMigrationTimeSeconds,
      "market.baseTokenVesting.cliffDurationFromMigrationTimeSeconds",
    );
    const lockedVesting = getLockedVestingParams(
      baseLockedAmount,
      baseNumberPeriods,
      baseCliffUnlock,
      baseTotalDuration,
      baseCliffDuration,
      TokenDecimal.NINE,
    );
    const sqrtPrices = [
      exactCurve.startSqrtPriceQ64x64,
      ...exactCurve.segments.map((segment) => segment.upperSqrtPriceQ64x64),
    ].map(sdkBn);
    const exactSdkCurve = exactBoundaryCurve(exactCurve);
    const minimumBuilderSupply = getTotalSupplyFromCurve(
      sdkBn(exactCurve.migrationQuoteThresholdAtomic),
      sdkBn(exactCurve.startSqrtPriceQ64x64),
      exactSdkCurve,
      lockedVesting,
      MigrationOption.MET_DAMM_V2,
      sdkBn(0n),
      Number(migrationFee.feeBps / 100n),
    );
    const minimumBuilderSupplyAtomic = safeSdkInteger(minimumBuilderSupply);
    if (minimumBuilderSupplyAtomic === undefined || minimumBuilderSupplyAtomic > supplyInAtomic) {
      throw new RangeError("The fixed supply is below the SDK minimum for this compiled curve");
    }
    const derivedLeftoverAtomic = supplyInAtomic - minimumBuilderSupplyAtomic;
    const sdkBuilderLeftoverTokenUnits = ceilDiv(derivedLeftoverAtomic, BASE_TOKEN_ATOMIC_SCALE);
    if (sdkBuilderLeftoverTokenUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("The SDK builder leftover is outside its safe whole-token input range");
    }
    const vestingSchedule = fields.vesting;
    const scheduleDuration = wholeHumanAmount(
      vestingSchedule.durationSeconds,
      "liquidityVestingSchedule.durationSeconds",
    );
    const scheduleCliff = wholeHumanAmount(
      vestingSchedule.cliffDurationFromMigrationTimeSeconds,
      "liquidityVestingSchedule.cliffDurationFromMigrationTimeSeconds",
    );
    const bpsPerPeriod = wholeHumanAmount(
      vestingSchedule.bpsPerPeriod,
      "liquidityVestingSchedule.bpsPerPeriod",
    );
    const periodCount = vestingSchedule.periodCount as number;
    const profileSdkParams: Parameters<typeof buildCurveWithCustomSqrtPrices>[0] = {
      token: {
        tokenType: TokenType.SPLToken,
        tokenBaseDecimal: TokenDecimal.NINE,
        tokenQuoteDecimal: fields.quote.decimals as number,
        tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
        totalTokenSupply: totalSupply,
        leftover: Number(sdkBuilderLeftoverTokenUnits),
      },
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          feeSchedulerParam: {
            startingFeeBps: Number(baseSchedule.feeBps),
            endingFeeBps: Number(baseSchedule.feeBps),
            numberOfPeriod: 0,
            totalDuration: 0,
          },
        },
        dynamicFeeEnabled: false,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: Number(BigInt(creatorTradingFeeShareBps) / 100n),
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: {
          feePercentage: Number(migrationFee.feeBps / 100n),
          creatorFeePercentage: Number(migrationFee.creatorFeeShareBps / 100n),
        },
        migratedPoolFee: {
          collectFeeMode: MigratedCollectFeeMode.Compounding,
          dynamicFee: DammV2DynamicFeeMode.Disabled,
          poolFeeBps: Number(migratedPoolFee.feeBps),
          compoundingFeeBps: Number(migratedPoolFee.compoundingFeeBps ?? 0n),
          baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
          marketCapFeeSchedulerParams: {
            endingBaseFeeBps: fields.marketCapFeeScheduler.endingBaseFeeBps as number,
            numberOfPeriod: fields.marketCapFeeScheduler.numberOfPeriod as number,
            priceMultiple: fields.marketCapFeeScheduler.priceMultiple as number,
            schedulerExpirationDuration: fields.marketCapFeeScheduler
              .schedulerExpirationDuration as number,
          },
        },
      },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: Number(
          allocation.partner.permanentlyLockedBps / 100n,
        ),
        partnerLiquidityPercentage: Number(allocation.partner.unlockedBps / 100n),
        partnerLiquidityVestingInfoParams: {
          vestingPercentage: Number(allocation.partner.vestingBps / 100n),
          bpsPerPeriod,
          numberOfPeriods: periodCount,
          cliffDurationFromMigrationTime: scheduleCliff,
          totalDuration: scheduleDuration,
        },
        creatorPermanentLockedLiquidityPercentage: Number(
          allocation.creator.permanentlyLockedBps / 100n,
        ),
        creatorLiquidityPercentage: Number(allocation.creator.unlockedBps / 100n),
        creatorLiquidityVestingInfoParams: {
          vestingPercentage: Number(allocation.creator.vestingBps / 100n),
          bpsPerPeriod,
          numberOfPeriods: periodCount,
          cliffDurationFromMigrationTime: scheduleCliff,
          totalDuration: scheduleDuration,
        },
      },
      lockedVesting: {
        totalLockedVestingAmount: baseLockedAmount,
        numberOfVestingPeriod: baseNumberPeriods,
        cliffUnlockAmount: baseCliffUnlock,
        totalVestingDuration: baseTotalDuration,
        cliffDurationFromMigrationTime: baseCliffDuration,
      },
      activationType: ActivationType.Slot,
      sqrtPrices,
      liquidityWeights: exactCurve.segments.map(() => 1),
    };
    const sdkBuilt = buildCurveWithCustomSqrtPrices(profileSdkParams);
    const sdkConfig: ConfigParameters = {
      ...sdkBuilt,
      sqrtStartPrice: sdkBn(exactCurve.startSqrtPriceQ64x64),
      migrationQuoteThreshold: sdkBn(exactCurve.migrationQuoteThresholdAtomic),
      curve: exactSdkCurve,
    };
    validateSdkConfigurationWithoutRuntimeReceiver(sdkConfig);
    const supplyEvidence = validateFixedSupplyWithoutRuntimeReceiver(sdkConfig);
    const dayOneLockedLiquidityBps = calculateLockedLiquidityBpsAtTime(
      sdkConfig.partnerPermanentLockedLiquidityPercentage,
      sdkConfig.creatorPermanentLockedLiquidityPercentage,
      sdkConfig.partnerLiquidityVestingInfo,
      sdkConfig.creatorLiquidityVestingInfo,
      SECONDS_PER_DAY,
    );
    if (
      !validateMinimumLockedLiquidity(
        sdkConfig.partnerPermanentLockedLiquidityPercentage,
        sdkConfig.creatorPermanentLockedLiquidityPercentage,
        sdkConfig.partnerLiquidityVestingInfo,
        sdkConfig.creatorLiquidityVestingInfo,
      )
    ) {
      throw new RangeError("The pinned SDK day-one liquidity lock requirement is not met");
    }
    const curveShape = validateDbcCurveShape(exactCurve);
    if (curveShape.status === "invalid") throw new TypeError("The compiled curve shape is invalid");
    if (!validateCurve(sdkConfig.curve, sdkConfig.sqrtStartPrice)) {
      throw new TypeError("The pinned SDK rejected the exact compiled curve");
    }
    const candidate: DeploymentCandidate = {
      schemaVersion: 1,
      profileId: "demo-v1",
      network: "devnet",
      market: {
        marketIntent: (input.compileRequest as UnknownRecord).marketIntent,
        objectiveWeights: (input.compileRequest as UnknownRecord).objectiveWeights,
        simulationConfiguration: (input.compileRequest as UnknownRecord).simulation,
        deploymentConfiguration: {
          baseToken: {
            name: fields.base.name as string,
            symbol: fields.base.symbol as string,
            decimals: 9,
            supplyMode: "fixed",
            totalSupply: fields.base.totalSupply as string,
          },
          quoteToken: {
            symbol: fields.quote.symbol as string,
            decimals: 6,
            mint: fields.quote.mint as string,
            liveVerification: "required-before-transaction-preflight",
          },
          poolCreationFeeLamports: fields.market?.poolCreationFeeLamports as string,
        },
        candidate: selected,
        solverStatus: report.solverStatus as "satisfied" | "partial",
        engineVersion: report.run?.engineVersion ?? "unknown",
        algorithmVersion: report.run?.algorithmVersion ?? "unknown",
        sdkVersion: report.run?.sdkVersion ?? PINNED_METEORA_DBC_SDK_VERSION,
      },
      migration,
      authority: { mode: "runtime-deployer" },
      metadata: {
        uri: fields.metadata.uri as string,
        status: "unresolved",
        assetPath: fields.metadata.assetPath as string,
      },
      sdkConfig,
      sdkValidation: {
        sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
        configurationParameters: "accepted-with-runtime-receiver-deferred",
        fixedSupplyBounds: "accepted-by-pinned-sdk-helpers",
        runtimeReceiver: "deployer-wallet-required-at-transaction-validation",
        ...supplyEvidence,
        dayOneLockedLiquidityBps,
      },
      assumptions: parsedProfile.value.assumptions as string[],
    };
    return validateDeploymentCandidate(candidate);
  } catch {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.candidate",
          "demo_candidate_assembly_failed",
          "The seeded demo candidate could not be assembled or validated by the pinned SDK path.",
        ),
      ],
    };
  }
}

function selectCandidate(
  report: CliCompileReport,
  candidateId?: string,
): CompileDraftCandidate | undefined {
  const candidates = candidateId
    ? report.draftCandidates.filter((candidate) => candidate.id === candidateId)
    : [...report.draftCandidates].sort(
        (left, right) =>
          left.objectiveScore.comparedTo(right.objectiveScore) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
  return candidates[0];
}

function validateDeploymentCandidate(input: unknown): DeploymentCandidateResult {
  if (!isRecord(input)) {
    return {
      status: "invalid",
      issues: [issue("$", "candidate_required", "A complete deployment candidate is required.")],
    };
  }
  if (
    input.schemaVersion !== 1 ||
    input.profileId !== "demo-v1" ||
    input.network !== "devnet" ||
    !isRecord(input.market) ||
    !isRecord(input.market.candidate) ||
    !isRecord(input.authority) ||
    input.authority.mode !== "runtime-deployer" ||
    !isRecord(input.metadata) ||
    !isRecord(input.sdkConfig) ||
    !isRecord(input.sdkValidation) ||
    !Array.isArray(input.assumptions) ||
    input.assumptions.length === 0
  ) {
    return {
      status: "invalid",
      issues: [
        issue("$", "candidate_incomplete", "The deployment candidate is structurally incomplete."),
      ],
    };
  }
  if (input.metadata.status !== "unresolved" && input.metadata.status !== "resolved") {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.metadata.status",
          "invalid_metadata_status",
          "Metadata status must be unresolved or resolved.",
        ),
      ],
    };
  }
  if (typeof input.metadata.uri !== "string" || input.metadata.uri.length === 0) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.metadata.uri",
          "metadata_uri_required",
          "The explicit metadata URI placeholder or resolved URI is required.",
        ),
      ],
    };
  }
  if (
    (input.metadata.status === "unresolved" &&
      input.metadata.uri !== DEMO_V1_METADATA_URI_PLACEHOLDER) ||
    (input.metadata.status === "resolved" && !validMetadataUri(input.metadata.uri))
  ) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.metadata.uri",
          "metadata_resolution_mismatch",
          "Unresolved metadata must use the named placeholder; resolved metadata must use an absolute HTTPS or IPFS URI.",
        ),
      ],
    };
  }
  if (input.authority.publicKey !== undefined && !validWalletAddress(input.authority.publicKey)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.authority.publicKey",
          "invalid_runtime_authority",
          "The runtime deployer address is invalid.",
        ),
      ],
    };
  }
  if (!isRecord(input.migration)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.migration",
          "migration_configuration_required",
          "Complete migration settings are required.",
        ),
      ],
    };
  }
  let migrationValue: unknown;
  try {
    migrationValue = convertConfigBigintStrings(input.migration, "$.migration");
  } catch {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.migration",
          "invalid_migration_integer",
          "Migration fields must use valid decimal integer values.",
        ),
      ],
    };
  }
  const migration = validateMigrationConfiguration(migrationValue);
  if (migration.status === "invalid") return { status: "invalid", issues: migration.issues };
  if (
    !isDemoV1Migration(migration.value) ||
    !isRecord(input.market.deploymentConfiguration) ||
    !isRecord(input.market.deploymentConfiguration.baseToken) ||
    !isRecord(input.market.deploymentConfiguration.quoteToken) ||
    !isRecord(input.market.simulationConfiguration) ||
    !isRecord(input.market.objectiveWeights) ||
    !isRecord(input.market.candidate) ||
    !isRecord(input.market.candidate.curve)
  ) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.market",
          "candidate_market_incomplete",
          "Compiled market, deployment asset settings, and simulation settings are required.",
        ),
      ],
    };
  }
  const marketCandidate: UnknownRecord = {
    ...input.market.candidate,
    curve: restoreSerializedCurveIntegers(input.market.candidate.curve),
  };
  const curve = marketCandidate.curve as unknown as DbcCurve;
  const curveValidation = validateDbcCurveShape(curve);
  if (curveValidation.status === "invalid")
    return { status: "invalid", issues: curveValidation.issues };
  const sdkConfig = restoreSerializedSdkIntegers(input.sdkConfig) as ConfigParameters;
  try {
    const deployment = input.market.deploymentConfiguration as UnknownRecord;
    const baseToken = deployment.baseToken as UnknownRecord;
    const quoteToken = deployment.quoteToken as UnknownRecord;
    const simulation = input.market.simulationConfiguration;
    const simulationFees = isRecord(simulation.fees) ? simulation.fees : undefined;
    const simulationBaseFee =
      simulationFees && isRecord(simulationFees.base) ? simulationFees.base : undefined;
    const simulationMigration = isRecord(simulation.migration) ? simulation.migration : undefined;
    const intent = validateMarketIntent(input.market.marketIntent);
    const compileReport = compileDocument({
      marketIntent: input.market.marketIntent,
      objectiveWeights: input.market.objectiveWeights,
      simulation,
    });
    const recomputedCandidate =
      typeof marketCandidate.id === "string"
        ? selectCandidate(compileReport, marketCandidate.id)
        : undefined;
    if (
      !recomputedCandidate ||
      JSON.stringify(canonicalJson(recomputedCandidate)) !==
        JSON.stringify(canonicalJson(marketCandidate)) ||
      input.market.solverStatus !== compileReport.solverStatus ||
      input.market.engineVersion !== (compileReport.run?.engineVersion ?? "unknown") ||
      input.market.algorithmVersion !== (compileReport.run?.algorithmVersion ?? "unknown") ||
      input.market.sdkVersion !== (compileReport.run?.sdkVersion ?? PINNED_METEORA_DBC_SDK_VERSION)
    ) {
      throw new TypeError("Compiled market evidence does not reproduce from its retained inputs");
    }
    const curveEntries = sdkConfig.curve as readonly unknown[];
    const sdkPreMigrationSupply = safeSdkInteger(sdkConfig.tokenSupply?.preMigrationTokenSupply);
    const sdkPostMigrationSupply = safeSdkInteger(sdkConfig.tokenSupply?.postMigrationTokenSupply);
    const expectedSupply =
      intent.status === "valid" ? intent.normalized.totalBaseAtomic : undefined;
    const sdkStartPrice = safeSdkInteger(sdkConfig.sqrtStartPrice);
    const sdkThreshold = safeSdkInteger(sdkConfig.migrationQuoteThreshold);
    if (
      intent.status !== "valid" ||
      !isDemoV1MarketIntent(input.market.marketIntent) ||
      !isDemoV1ObjectiveWeights(input.market.objectiveWeights) ||
      !isDemoV1SimulationConfiguration(simulation) ||
      baseToken.decimals !== 9 ||
      baseToken.name !== "Tymba Devnet Demo" ||
      baseToken.symbol !== "MKT" ||
      baseToken.supplyMode !== "fixed" ||
      baseToken.symbol !== intent.normalized.assets.base.symbol ||
      quoteToken.decimals !== 6 ||
      quoteToken.symbol !== "USDC" ||
      quoteToken.symbol !== intent.normalized.assets.quote.symbol ||
      quoteToken.mint !== DEMO_V1_QUOTE_MINT ||
      quoteToken.liveVerification !== "required-before-transaction-preflight" ||
      deployment.poolCreationFeeLamports !== "0" ||
      simulation.supplyMode !== "fixed" ||
      simulation.activationType !== "slot" ||
      simulationMigration?.destination !== "damm-v2" ||
      simulationFees?.collectFeeMode !== "quote" ||
      simulationBaseFee?.kind !== "fixed" ||
      simulationBaseFee.feeBps !== "25" ||
      simulationFees?.creatorTradingFeeShareBps !== "2500" ||
      input.market.solverStatus !== "satisfied" ||
      input.market.sdkVersion !== PINNED_METEORA_DBC_SDK_VERSION ||
      marketCandidate.verificationStatus !== "unverified" ||
      curve.baseDecimals !== 9 ||
      curve.quoteDecimals !== 6 ||
      sdkStartPrice !== curve.startSqrtPriceQ64x64 ||
      sdkThreshold !== curve.migrationQuoteThresholdAtomic ||
      expectedSupply === undefined ||
      sdkPreMigrationSupply === undefined ||
      sdkPreMigrationSupply !== expectedSupply ||
      sdkPostMigrationSupply === undefined ||
      sdkPostMigrationSupply > sdkPreMigrationSupply ||
      bigintString(baseToken.totalSupply) === undefined ||
      BigInt(baseToken.totalSupply as string) * BASE_TOKEN_ATOMIC_SCALE !== expectedSupply ||
      curveEntries.length !== curve.segments.length ||
      curveEntries.some((entry, index) => {
        if (!isRecord(entry)) return true;
        const segment = curve.segments[index];
        return (
          !segment ||
          safeSdkInteger(entry.sqrtPrice) !== segment.upperSqrtPriceQ64x64 ||
          safeSdkInteger(entry.liquidity) !== segment.liquidity
        );
      })
    ) {
      throw new TypeError("Compiled market and SDK candidate fields do not agree");
    }
    const sdkMigrationFee = sdkConfig.migrationFee;
    const sdkLiquidity = {
      creator: {
        unlocked: sdkConfig.creatorLiquidityPercentage,
        permanentlyLocked: sdkConfig.creatorPermanentLockedLiquidityPercentage,
        vesting: sdkConfig.creatorLiquidityVestingInfo?.vestingPercentage,
      },
      partner: {
        unlocked: sdkConfig.partnerLiquidityPercentage,
        permanentlyLocked: sdkConfig.partnerPermanentLockedLiquidityPercentage,
        vesting: sdkConfig.partnerLiquidityVestingInfo?.vestingPercentage,
      },
    };
    const sdkFeeNumerator = safeSdkInteger(sdkConfig.poolFees?.baseFee?.cliffFeeNumerator);
    const expectedFeeNumerator = bpsToFeeNumerator(Number(simulationBaseFee?.feeBps));
    const lockDurationSeconds = migration.value.allocationIntent?.lockDurationSeconds;
    const partnerVesting = sdkConfig.partnerLiquidityVestingInfo;
    const creatorVesting = sdkConfig.creatorLiquidityVestingInfo;
    if (
      sdkConfig.migrationOption !== MigrationOption.MET_DAMM_V2 ||
      sdkConfig.activationType !== ActivationType.Slot ||
      sdkConfig.collectFeeMode !== CollectFeeMode.QuoteToken ||
      sdkConfig.tokenType !== TokenType.SPLToken ||
      sdkConfig.tokenDecimal !== TokenDecimal.NINE ||
      sdkConfig.tokenUpdateAuthority !== TokenAuthorityOption.CreatorUpdateAuthority ||
      sdkConfig.poolFees?.dynamicFee !== null ||
      sdkConfig.poolCreationFee === undefined ||
      safeSdkInteger(sdkConfig.poolCreationFee) !== 0n ||
      sdkConfig.enableFirstSwapWithMinFee !== false ||
      sdkConfig.leftoverReceiver !== undefined ||
      !sdkMigrationFee ||
      sdkMigrationFee.feePercentage !== Number(migration.value.fee?.feeBps ?? -1n) / 100 ||
      sdkMigrationFee.creatorFeePercentage !==
        Number(migration.value.fee?.creatorFeeShareBps ?? -1n) / 100 ||
      sdkFeeNumerator !== safeSdkInteger(expectedFeeNumerator) ||
      sdkConfig.creatorTradingFeePercentage !==
        Number(BigInt(simulationFees?.creatorTradingFeeShareBps as string) / 100n) ||
      sdkConfig.migratedPoolFee?.poolFeeBps !==
        Number(migration.value.migratedPoolFee?.feeBps ?? -1n) ||
      sdkConfig.migratedPoolFee?.collectFeeMode !== MigratedCollectFeeMode.Compounding ||
      sdkConfig.migratedPoolFee?.dynamicFee !== DammV2DynamicFeeMode.Disabled ||
      sdkConfig.migratedPoolBaseFeeMode !== DammV2BaseFeeMode.FeeTimeSchedulerLinear ||
      !sdkConfig.migratedPoolMarketCapFeeSchedulerParams ||
      sdkConfig.migratedPoolMarketCapFeeSchedulerParams.numberOfPeriod !== 0 ||
      sdkConfig.migratedPoolMarketCapFeeSchedulerParams.sqrtPriceStepBps !== 0 ||
      sdkConfig.migratedPoolMarketCapFeeSchedulerParams.schedulerExpirationDuration !== 0 ||
      safeSdkInteger(sdkConfig.migratedPoolMarketCapFeeSchedulerParams.reductionFactor) !== 0n ||
      sdkConfig.migrationFeeOption !== MigrationFeeOption.Customizable ||
      sdkConfig.compoundingFeeBps !==
        Number(migration.value.migratedPoolFee?.compoundingFeeBps ?? -1n) ||
      !lockDurationSeconds ||
      !partnerVesting ||
      !creatorVesting ||
      partnerVesting.bpsPerPeriod !== 10_000 ||
      creatorVesting.bpsPerPeriod !== 10_000 ||
      partnerVesting.numberOfPeriods !== 1 ||
      creatorVesting.numberOfPeriods !== 1 ||
      partnerVesting.cliffDurationFromMigrationTime !== 0 ||
      creatorVesting.cliffDurationFromMigrationTime !== 0 ||
      partnerVesting.frequency !== Number(lockDurationSeconds) ||
      creatorVesting.frequency !== Number(lockDurationSeconds) ||
      (Object.keys(sdkLiquidity) as (keyof typeof sdkLiquidity)[]).some((party) => {
        const expected = migration.value.liquidityAllocation?.[party];
        if (!expected) return true;
        return (
          sdkLiquidity[party].unlocked !== Number(expected.unlockedBps / 100n) ||
          sdkLiquidity[party].permanentlyLocked !== Number(expected.permanentlyLockedBps / 100n) ||
          sdkLiquidity[party].vesting !== Number(expected.vestingBps / 100n)
        );
      })
    ) {
      throw new TypeError(
        "SDK economic fields do not match the seeded migration and compile inputs",
      );
    }
    validateSdkConfigurationWithoutRuntimeReceiver(sdkConfig);
    const supplyEvidence = validateFixedSupplyWithoutRuntimeReceiver(sdkConfig);
    const dayOneLockedLiquidityBps = calculateLockedLiquidityBpsAtTime(
      sdkConfig.partnerPermanentLockedLiquidityPercentage,
      sdkConfig.creatorPermanentLockedLiquidityPercentage,
      sdkConfig.partnerLiquidityVestingInfo,
      sdkConfig.creatorLiquidityVestingInfo,
      SECONDS_PER_DAY,
    );
    if (
      !validateMinimumLockedLiquidity(
        sdkConfig.partnerPermanentLockedLiquidityPercentage,
        sdkConfig.creatorPermanentLockedLiquidityPercentage,
        sdkConfig.partnerLiquidityVestingInfo,
        sdkConfig.creatorLiquidityVestingInfo,
      ) ||
      input.sdkValidation.sdkVersion !== PINNED_METEORA_DBC_SDK_VERSION ||
      input.sdkValidation.configurationParameters !== "accepted-with-runtime-receiver-deferred" ||
      input.sdkValidation.fixedSupplyBounds !== "accepted-by-pinned-sdk-helpers" ||
      input.sdkValidation.runtimeReceiver !==
        "deployer-wallet-required-at-transaction-validation" ||
      input.sdkValidation.minimumPreMigrationSupplyAtomic !==
        supplyEvidence.minimumPreMigrationSupplyAtomic ||
      input.sdkValidation.minimumPostMigrationSupplyAtomic !==
        supplyEvidence.minimumPostMigrationSupplyAtomic ||
      input.sdkValidation.derivedLeftoverAtomic !== supplyEvidence.derivedLeftoverAtomic ||
      input.sdkValidation.sdkBuilderLeftoverTokenUnits !==
        supplyEvidence.sdkBuilderLeftoverTokenUnits ||
      input.sdkValidation.dayOneLockedLiquidityBps !== dayOneLockedLiquidityBps
    ) {
      throw new TypeError("Candidate SDK validation evidence does not match recomputed values");
    }
    if (
      !Array.isArray(input.assumptions) ||
      input.assumptions.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      throw new TypeError("Profile assumptions are invalid");
    }
    return { status: "complete", candidate: input as unknown as DeploymentCandidate };
  } catch {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.sdkConfig",
          "sdk_candidate_invalid",
          "The complete SDK candidate did not pass offline configuration and supply checks.",
        ),
      ],
    };
  }
}

function validWalletAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const publicKey = new PublicKey(value);
    return publicKey.toBase58() === value && PublicKey.isOnCurve(publicKey.toBytes());
  } catch {
    return false;
  }
}

function validPublicAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const publicKey = new PublicKey(value);
    return publicKey.toBase58() === value && !publicKey.equals(PublicKey.default);
  } catch {
    return false;
  }
}

function validMetadataUri(value: string): boolean {
  if (
    value === DEMO_V1_METADATA_URI_PLACEHOLDER ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value) ||
    new TextEncoder().encode(value).byteLength > 200
  ) {
    return false;
  }
  try {
    const uri = new URL(value);
    return (
      (uri.protocol === "https:" || uri.protocol === "ipfs:") &&
      uri.hostname.length > 0 &&
      uri.username.length === 0 &&
      uri.password.length === 0
    );
  } catch {
    return false;
  }
}

export function resolveCandidateAuthority(
  candidate: DeploymentCandidate,
  publicKey: string,
): DeploymentCandidateResult {
  if (!validWalletAddress(publicKey)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.authority.publicKey",
          "invalid_runtime_authority",
          "Connect a valid Solana wallet account.",
        ),
      ],
    };
  }
  return validateDeploymentCandidate({
    ...candidate,
    authority: { mode: "runtime-deployer", publicKey },
  });
}

export function resolveCandidateMetadata(
  candidate: DeploymentCandidate,
  uri: string,
): DeploymentCandidateResult {
  if (!validMetadataUri(uri)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.metadata.uri",
          "invalid_metadata_uri",
          "Resolve the placeholder to an absolute HTTPS or IPFS metadata URI.",
        ),
      ],
    };
  }
  return validateDeploymentCandidate({
    ...candidate,
    metadata: { ...candidate.metadata, uri, status: "resolved" },
  });
}

export type CandidateSdkResolutionResult =
  | Readonly<{ status: "valid"; value: CompleteSdkConfigCandidate }>
  | Readonly<{ status: "invalid"; issues: readonly ConfigurationValidationIssue[] }>;

export function resolveCandidateSdkConfig(
  input: unknown,
  connectedWalletPublicKey: string,
): CandidateSdkResolutionResult {
  const candidateResult = validateDeploymentCandidate(input);
  if (candidateResult.status === "invalid") return candidateResult;
  const candidate = candidateResult.candidate;
  if (
    !validWalletAddress(connectedWalletPublicKey) ||
    candidate.authority.publicKey === undefined
  ) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.authority.publicKey",
          "runtime_authority_unresolved",
          "Connect and resolve the Devnet deployer wallet before transaction assembly.",
        ),
      ],
    };
  }
  if (candidate.authority.publicKey !== connectedWalletPublicKey) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.authority.publicKey",
          "runtime_authority_mismatch",
          "The connected wallet does not match the resolved runtime deployer.",
        ),
      ],
    };
  }
  if (candidate.metadata.status !== "resolved" || !validMetadataUri(candidate.metadata.uri)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "$.metadata.uri",
          "metadata_uri_unresolved",
          "Publish the Devnet metadata fixture and resolve its stable URI before transaction assembly.",
        ),
      ],
    };
  }
  return validateCompleteSdkConfigCandidate({
    ...candidate.sdkConfig,
    leftoverReceiver: new PublicKey(connectedWalletPublicKey),
  });
}

export type DemoV1MarketTransactionBuildResult =
  | MeteoraMarketTransactionBuildResult
  | Readonly<{
      status: "blocked";
      stage: "candidate-resolution";
      issues: readonly ConfigurationValidationIssue[];
    }>;

export async function buildDemoV1MarketTransaction(
  input: Readonly<{
    connection: Connection;
    candidate: DeploymentCandidate;
    connectedWalletPublicKey: string;
    config: PublicKey;
    baseMint: PublicKey;
    tokenBadge?: PublicKey;
  }>,
): Promise<DemoV1MarketTransactionBuildResult> {
  const resolved = resolveCandidateSdkConfig(input.candidate, input.connectedWalletPublicKey);
  if (resolved.status === "invalid") {
    return { status: "blocked", stage: "candidate-resolution", issues: resolved.issues };
  }
  const deployment = input.candidate.market.deploymentConfiguration;
  return buildMeteoraMarketTransaction({
    connection: input.connection,
    candidate: resolved.value,
    config: input.config,
    baseMint: input.baseMint,
    feeClaimer: new PublicKey(input.connectedWalletPublicKey),
    quoteMint: new PublicKey(deployment.quoteToken.mint),
    quoteDecimals: deployment.quoteToken.decimals,
    payer: new PublicKey(input.connectedWalletPublicKey),
    tokenName: deployment.baseToken.name,
    tokenSymbol: deployment.baseToken.symbol,
    tokenMetadataUri: input.candidate.metadata.uri,
    ...(input.tokenBadge ? { tokenBadge: input.tokenBadge } : {}),
  });
}

function validDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function sendDeployment(context: DeploymentSendContext): DeploymentSendResult {
  const reasons: Extract<DeploymentSendResult, { status: "blocked" }>["reasons"][number][] = [];
  if (validateDeploymentCandidate(context.candidate).status !== "complete")
    reasons.push("candidate-incomplete");
  const wallet = context.connectedWalletPublicKey;
  if (!validWalletAddress(wallet) || context.candidate.authority.publicKey === undefined) {
    reasons.push("wallet-unresolved");
  } else if (context.candidate.authority.publicKey !== wallet) {
    reasons.push("wallet-mismatch");
  }
  if (
    context.candidate.metadata.status !== "resolved" ||
    !validMetadataUri(context.candidate.metadata.uri)
  ) {
    reasons.push("metadata-unresolved");
  }
  if (context.rpcEndpoint !== DEVNET_RPC_URL || context.genesisHash !== DEVNET_GENESIS_HASH) {
    reasons.push("devnet-unconfirmed");
  }
  const digest = context.transactionMessageDigestHex;
  if (
    context.preflight.status !== "sufficient" ||
    !validDigest(context.preflight.messageDigestHex) ||
    context.preflight.messageDigestHex !== digest
  ) {
    reasons.push("preflight-incomplete");
  }
  if (
    context.simulation.status !== "succeeded" ||
    !validDigest(context.simulation.messageDigestHex) ||
    context.simulation.messageDigestHex !== digest
  ) {
    reasons.push("simulation-incomplete");
  }
  if (context.approval.status === "rejected") {
    reasons.push("approval-rejected");
  } else if (context.approval.status !== "approved") {
    reasons.push("approval-required");
  } else if (
    context.approval.approverAddress !== wallet ||
    context.approval.messageDigestHex !== digest ||
    !validDigest(context.approval.messageDigestHex)
  ) {
    reasons.push("approval-mismatch");
  }
  if (!validDigest(digest)) reasons.push("approval-mismatch");
  if (reasons.length > 0) return { status: "blocked", reasons: [...new Set(reasons)] };
  return {
    status: "ready",
    candidateId: context.candidate.market.candidate.id,
    walletAddress: wallet,
    messageDigestHex: digest,
    broadcast: "not-invoked",
  };
}
