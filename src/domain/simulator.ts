import { Decimal } from "decimal.js";
import type { AppliedTradingFee } from "./fee-math.js";
import {
  feeNumeratorFromBps,
  feeOnIncludedAmount,
  grossUpExcludedAmount,
  resolveFeePlacement,
} from "./fee-math.js";
import type { CurrencyAmount } from "./currency-amount.js";
import { currencyAmount } from "./currency-amount.js";
import { MAX_CURVE_U64, MAX_CURVE_U128 } from "./curve.js";
import type {
  AssetAmount,
  AssetAmountPair,
  AssetSide,
  PoolEconomicSnapshot,
  PoolState,
  SimulationClock,
} from "./pool-state.js";
import {
  calculateMigrationQuoteAccounting,
  migrationSqrtPriceAtThreshold,
} from "./migration-math.js";
import { Q64_ONE, sqrtPriceQ64x64ToPrice } from "./price.js";
import { quoteBuy as quoteCurveBuy, quoteSell as quoteCurveSell } from "./curve-swap.js";
import type {
  BuyResult,
  SellResult,
  TradeFeeAmounts,
  TradeMetrics,
  TradeResult,
} from "./trade-result.js";
import { validatePoolState } from "./pool-state-validation.js";
import { calculatePostMigrationLiquidityAllocation } from "./migration-allocation.js";
import type { PostMigrationLiquidityAllocation } from "./migration-allocation.js";
import type { VerificationStatus } from "./status.js";
import type {
  DeterministicSimulationMetrics,
  DeterministicSimulationResult,
} from "./simulation.js";

const MAX_DYNAMIC_FEE_NUMERATOR = 990_000_000n;
const DYNAMIC_FEE_DENOMINATOR = 100_000_000_000n;
const DYNAMIC_FEE_ROUNDING_OFFSET = DYNAMIC_FEE_DENOMINATOR - 1n;
const BASIS_POINTS = 10_000n;
const DEFAULT_DYNAMIC_BIN_STEP_Q64 = Q64_ONE / BASIS_POINTS;
export const DBC_SIMULATION_ENGINE_VERSION = "0.1.0";
export const PINNED_SIMULATION_SDK_VERSION = "1.5.13";
const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });

export type DeterministicTradeInput = Readonly<{
  direction: "buy" | "sell";
  inputAtomic: bigint;
  clock?: SimulationClock;
}>;

export type DeterministicSimulationInput = Readonly<{
  id: string;
  initialState: PoolState;
  trades: readonly DeterministicTradeInput[];
  migrationSettlement?: MigrationSettlement;
}>;

export type MigrationSettlement = Readonly<{
  protocolLiquidityFee: AssetAmountPair;
  dammLiquidity: AssetAmountPair;
  leftoverBase: AssetAmount<"base">;
  liquidityUnits: bigint;
}>;

export type MigrationExecutionResult = Readonly<{
  state: PoolState;
  liquidityAllocation: PostMigrationLiquidityAllocation;
  verificationStatus: VerificationStatus;
}>;

export function quoteBuy(inputQuoteAtomic: bigint, state: PoolState): BuyResult {
  return quoteTrade("buy", inputQuoteAtomic, requireBondingState(state)) as BuyResult;
}

export function quoteSell(inputBaseAtomic: bigint, state: PoolState): SellResult {
  return quoteTrade("sell", inputBaseAtomic, requireBondingState(state)) as SellResult;
}

export function executeBuy(inputQuoteAtomic: bigint, state: PoolState): PoolState {
  return executeTrade("buy", inputQuoteAtomic, state);
}

export function executeSell(inputBaseAtomic: bigint, state: PoolState): PoolState {
  return executeTrade("sell", inputBaseAtomic, state);
}

export function executeMigration(
  input: PoolState,
  settlement: MigrationSettlement,
): MigrationExecutionResult {
  const state = requireValidState(input);
  if (state.migrationProgress !== "curve-complete") {
    throw new RangeError("Migration is only allowed after the DBC curve is complete");
  }

  const threshold = state.curve.migrationQuoteThresholdAtomic;
  const migrationAccounting = calculateMigrationQuoteAccounting(
    state.ledger.pool.quote.raw,
    threshold,
  );
  if (!migrationAccounting.curveComplete) {
    throw new RangeError("Pool quote reserve has not reached the migration threshold");
  }
  if (!state.migration.liquidityAllocation) {
    throw new RangeError("Migration requires a validated six-bucket liquidity allocation");
  }
  if (
    state.ledger.migration.partnerFee.amount.raw !== 0n ||
    state.ledger.migration.creatorFee.amount.raw !== 0n ||
    state.ledger.migration.protocolLiquidityFee.base.raw !== 0n ||
    state.ledger.migration.protocolLiquidityFee.quote.raw !== 0n ||
    state.ledger.migration.dammLiquidity.base.raw !== 0n ||
    state.ledger.migration.dammLiquidity.quote.raw !== 0n ||
    state.ledger.leftoverBase.amount.raw !== 0n
  ) {
    throw new RangeError("Migration accounting ledgers must be empty before migration executes");
  }

  validateSettlementAmount(
    settlement.protocolLiquidityFee.base,
    state.curve.baseDecimals,
    "Protocol base migration fee",
  );
  validateSettlementAmount(
    settlement.protocolLiquidityFee.quote,
    state.curve.quoteDecimals,
    "Protocol quote migration fee",
  );
  validateSettlementAmount(
    settlement.dammLiquidity.base,
    state.curve.baseDecimals,
    "DAMM base liquidity",
  );
  validateSettlementAmount(
    settlement.dammLiquidity.quote,
    state.curve.quoteDecimals,
    "DAMM quote liquidity",
  );
  if (
    settlement.leftoverBase.asset !== "base" ||
    settlement.leftoverBase.amount.decimals !== state.curve.baseDecimals
  ) {
    throw new RangeError("Migration leftover base amount must match the configured base asset");
  }
  validateInputAmount(settlement.leftoverBase.amount.raw);
  if (
    typeof settlement.liquidityUnits !== "bigint" ||
    settlement.liquidityUnits <= 0n ||
    settlement.liquidityUnits > MAX_CURVE_U128
  ) {
    throw new RangeError("Migration liquidity units must be a positive u128 bigint");
  }
  if (settlement.dammLiquidity.base.raw === 0n || settlement.dammLiquidity.quote.raw === 0n) {
    throw new RangeError("DAMM v2 migration liquidity must contain both base and quote assets");
  }

  const { partnerFeeAtomic, creatorFeeAtomic, quoteDepositAtomic } = getConfiguredMigrationFee(
    state,
    threshold,
  );
  const expectedSurplus = migrationAccounting.surplus;
  const creatorSurplusAtomic =
    (expectedSurplus.partnerCreatorAtomic * state.fees.creatorTradingFeeShareBps) / BASIS_POINTS;
  const expectedPartnerSurplusAtomic = expectedSurplus.partnerCreatorAtomic - creatorSurplusAtomic;
  if (
    state.ledger.surplus.protocol.amount.raw !== expectedSurplus.protocolAtomic ||
    state.ledger.surplus.partner.amount.raw !== expectedPartnerSurplusAtomic ||
    state.ledger.surplus.creator.amount.raw !== creatorSurplusAtomic
  ) {
    throw new RangeError("Pool surplus ledger does not match the migration reserve accounting");
  }

  const expectedQuoteDeposit = quoteDepositAtomic;
  if (
    settlement.protocolLiquidityFee.quote.raw + settlement.dammLiquidity.quote.raw !==
    expectedQuoteDeposit
  ) {
    throw new RangeError("Migration settlement does not conserve quote deposited toward DAMM v2");
  }
  const expectedQuoteReserve =
    expectedQuoteDeposit +
    partnerFeeAtomic +
    creatorFeeAtomic +
    migrationAccounting.overshootAtomic;
  if (state.ledger.pool.quote.raw !== expectedQuoteReserve) {
    throw new RangeError("Migration settlement does not account for the full quote reserve");
  }
  if (
    settlement.protocolLiquidityFee.base.raw +
      settlement.dammLiquidity.base.raw +
      settlement.leftoverBase.amount.raw !==
    state.ledger.pool.base.raw
  ) {
    throw new RangeError("Migration settlement does not conserve the full base reserve");
  }
  if (state.supply.mode === "dynamic" && settlement.leftoverBase.amount.raw !== 0n) {
    throw new RangeError("Dynamic-supply migration cannot assign fixed-supply leftover base");
  }

  const liquidityAllocation = calculatePostMigrationLiquidityAllocation(
    settlement.liquidityUnits,
    state.migration.liquidityAllocation,
  );
  const hasVesting = liquidityAllocation.creator.vesting + liquidityAllocation.partner.vesting > 0n;
  const nextState: PoolState = {
    ...state,
    ledger: {
      ...state.ledger,
      pool: {
        base: currencyAmount(0n, state.curve.baseDecimals),
        quote: currencyAmount(0n, state.curve.quoteDecimals),
      },
      migration: {
        partnerFee: taggedAmount("quote", partnerFeeAtomic, state.curve.quoteDecimals),
        creatorFee: taggedAmount("quote", creatorFeeAtomic, state.curve.quoteDecimals),
        protocolLiquidityFee: settlement.protocolLiquidityFee,
        dammLiquidity: settlement.dammLiquidity,
      },
      leftoverBase: settlement.leftoverBase,
    },
    migrationProgress: hasVesting ? "locked-vesting" : "migrated",
  };
  const validation = validatePoolState(nextState);
  if (validation.status === "invalid") {
    throw new RangeError(
      validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  return { state: validation.value, liquidityAllocation, verificationStatus: "unverified" };
}

export function getPoolEconomicSnapshot(input: PoolState): PoolEconomicSnapshot {
  const state = requireValidState(input);
  const migration = calculateMigrationQuoteAccounting(
    state.ledger.pool.quote.raw,
    state.curve.migrationQuoteThresholdAtomic,
  );
  const feePairs = [
    state.ledger.fees.totalTrading,
    state.ledger.fees.protocol,
    state.ledger.fees.referral,
  ];
  return {
    poolReserves: state.ledger.pool,
    baseDistributed: state.supply.baseDistributed,
    feesGenerated: {
      base: currencyAmount(
        feePairs.reduce((total, pair) => total + pair.base.raw, 0n),
        state.curve.baseDecimals,
      ),
      quote: currencyAmount(
        feePairs.reduce((total, pair) => total + pair.quote.raw, 0n),
        state.curve.quoteDecimals,
      ),
    },
    spotPrice: sqrtPriceQ64x64ToPrice(
      state.currentSqrtPriceQ64x64,
      state.curve.baseDecimals,
      state.curve.quoteDecimals,
    ),
    migrationProgressBps:
      state.migrationProgress === "bonding" ? migration.progressBps : BASIS_POINTS,
    migrationProgress: state.migrationProgress,
  };
}

export function getSpotPrice(input: PoolState): Decimal {
  const state = requireValidState(input);
  return sqrtPriceQ64x64ToPrice(
    state.currentSqrtPriceQ64x64,
    state.curve.baseDecimals,
    state.curve.quoteDecimals,
  );
}

export function getScheduledBaseFeeNumeratorAtClock(
  input: PoolState,
  clock: SimulationClock,
): bigint {
  return resolveBaseFeeNumerator(stateAtClock(requireValidState(input), clock));
}

export function getMigrationProgress(input: PoolState): Decimal {
  const state = requireValidState(input);
  if (state.migrationProgress !== "bonding") return new Decimal(1);
  const accounting = calculateMigrationQuoteAccounting(
    state.ledger.pool.quote.raw,
    state.curve.migrationQuoteThresholdAtomic,
  );
  return new Decimal(accounting.progressBps.toString()).div(BASIS_POINTS.toString());
}

export function runDeterministicSimulation(
  input: DeterministicSimulationInput,
): DeterministicSimulationResult {
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    throw new TypeError("Simulation run id must be a non-empty string");
  }
  const initialState = requireValidState(input.initialState);
  let state = initialState;
  let quoteAccumulated = state.ledger.pool.quote.raw;
  let peakPrice = getSpotPrice(state);
  let maximumPriceImpactBps = 0n;
  let maximumDrawdownBps = 0n;
  let hadPartialFill = false;
  const trades: TradeResult[] = [];
  let migrationResult: MigrationExecutionResult | undefined;

  for (const action of input.trades) {
    if (action.clock) state = stateAtClock(state, action.clock);
    const beforeQuoteReserve = state.ledger.pool.quote.raw;
    const trade =
      action.direction === "buy"
        ? quoteBuy(action.inputAtomic, state)
        : quoteSell(action.inputAtomic, state);
    state =
      action.direction === "buy"
        ? executeBuy(action.inputAtomic, state)
        : executeSell(action.inputAtomic, state);
    quoteAccumulated += state.ledger.pool.quote.raw - beforeQuoteReserve;
    trades.push(trade);
    if (trade.status === "partial") hadPartialFill = true;
    if (trade.metrics.priceImpactBps > maximumPriceImpactBps) {
      maximumPriceImpactBps = trade.metrics.priceImpactBps;
    }

    const spotPrice = trade.metrics.spotPriceAfter;
    if (spotPrice.greaterThan(peakPrice)) peakPrice = spotPrice;
    const drawdownBps = calculateDrawdownBps(peakPrice, spotPrice);
    if (drawdownBps > maximumDrawdownBps) maximumDrawdownBps = drawdownBps;
  }

  if (input.migrationSettlement) {
    migrationResult = executeMigration(state, input.migrationSettlement);
    state = migrationResult.state;
  }

  const snapshot = getPoolEconomicSnapshot(state);
  const totalBaseSupply = state.supply.totalBaseSupply.amount.raw;
  const baseDistributed = state.supply.baseDistributed.amount.raw;
  const finalMigrationSqrtPrice = migrationSqrtPriceAtThreshold(state.curve);
  const finalMigrationPrice = sqrtPriceQ64x64ToPrice(
    finalMigrationSqrtPrice,
    state.curve.baseDecimals,
    state.curve.quoteDecimals,
  );
  const humanTotalSupply = new ExactDecimal(totalBaseSupply.toString()).div(
    new ExactDecimal(10).pow(state.curve.baseDecimals),
  );
  const metrics: DeterministicSimulationMetrics = {
    migrated:
      state.migrationProgress === "locked-vesting" || state.migrationProgress === "migrated",
    finalSpotPrice: snapshot.spotPrice,
    finalMigrationPrice,
    finalMigrationFdv: finalMigrationPrice.mul(humanTotalSupply),
    quoteAccumulated: taggedAmount("quote", quoteAccumulated, state.curve.quoteDecimals),
    baseDistributed: state.supply.baseDistributed,
    baseDistributedBps: (baseDistributed * BASIS_POINTS) / totalBaseSupply,
    maximumPriceImpactBps,
    maximumDrawdownBps,
    feesGenerated: feeDelta(state, initialState),
    migrationFees: {
      partner: subtractAssetAmount(
        state.ledger.migration.partnerFee,
        initialState.ledger.migration.partnerFee.amount.raw,
      ),
      creator: subtractAssetAmount(
        state.ledger.migration.creatorFee,
        initialState.ledger.migration.creatorFee.amount.raw,
      ),
    },
    surplus: state.ledger.surplus,
    ...(migrationResult ? { liquidityAllocation: migrationResult.liquidityAllocation } : {}),
  };

  return {
    id: input.id,
    engineVersion: DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: PINNED_SIMULATION_SDK_VERSION,
    startedAtSeconds: initialState.clock.timestampSeconds,
    completedAtSeconds: state.clock.timestampSeconds,
    kind: "deterministic",
    status: hadPartialFill ? "partial" : "completed",
    initialState,
    finalState: state,
    trades,
    metrics,
    verificationStatus: migrationResult?.verificationStatus ?? "unverified",
  };
}

function quoteTrade(direction: "buy" | "sell", inputAtomic: bigint, state: PoolState): TradeResult {
  validateInputAmount(inputAtomic);
  if (inputAtomic === 0n) throw new RangeError("Swap input must be greater than zero");

  const feePlacement = resolveFeePlacement(direction, state.fees.collectFeeMode);
  const feeNumerator = resolveTradeFeeNumerator(state);
  const inputFee =
    feePlacement.chargedOn === "input" ? feeOnIncludedAmount(inputAtomic, feeNumerator) : undefined;
  const curveInputAtomic = inputFee?.netAmountAtomic ?? inputAtomic;
  const migrationPrice =
    direction === "buy" ? migrationSqrtPriceAtThreshold(state.curve) : undefined;

  if (migrationPrice !== undefined && state.currentSqrtPriceQ64x64 > migrationPrice) {
    throw new RangeError("Bonding-curve price cannot exceed its migration price");
  }

  const curveQuote =
    direction === "buy"
      ? quoteCurveBuy(state.curve, curveInputAtomic, state.currentSqrtPriceQ64x64, migrationPrice)
      : quoteCurveSell(state.curve, curveInputAtomic, state.currentSqrtPriceQ64x64);
  const outputReserve =
    direction === "buy" ? state.ledger.pool.base.raw : state.ledger.pool.quote.raw;
  if (curveQuote.outputAtomic > outputReserve) {
    throw new RangeError("Trade output exceeds the available pool reserve");
  }

  const appliedFee =
    inputFee === undefined
      ? feeOnIncludedAmount(curveQuote.outputAtomic, feeNumerator)
      : curveQuote.unfilledInputAtomic === 0n
        ? inputFee
        : grossUpExcludedAmount(curveQuote.consumedInputAtomic, feeNumerator);
  const consumedInputAtomic =
    inputFee === undefined ? curveQuote.consumedInputAtomic : appliedFee.grossAmountAtomic;
  const outputAtomic =
    inputFee === undefined ? appliedFee.netAmountAtomic : curveQuote.outputAtomic;
  const unfilledInputAtomic = inputAtomic - consumedInputAtomic;
  validateResultAmounts(consumedInputAtomic, unfilledInputAtomic, outputAtomic, appliedFee);

  const feeAsset = feePlacement.asset;
  const decimals = feeAsset === "base" ? state.curve.baseDecimals : state.curve.quoteDecimals;
  const fees = tradeFeeAmounts(appliedFee, feeAsset, decimals);
  const poolReservesAfter = projectedPoolReserves(direction, state, curveQuote);
  const spotPriceBefore = sqrtPriceQ64x64ToPrice(
    state.currentSqrtPriceQ64x64,
    state.curve.baseDecimals,
    state.curve.quoteDecimals,
  );
  const spotPriceAfter = sqrtPriceQ64x64ToPrice(
    curveQuote.nextSqrtPriceQ64x64,
    state.curve.baseDecimals,
    state.curve.quoteDecimals,
  );
  const metrics: TradeMetrics = {
    spotPriceBefore,
    spotPriceAfter,
    priceImpactBps: calculatePriceImpactBps(spotPriceBefore, spotPriceAfter),
    migrationProgressBeforeBps: migrationProgressBps(
      state.ledger.pool.quote.raw,
      state.curve.migrationQuoteThresholdAtomic,
    ),
    migrationProgressAfterBps: migrationProgressBps(
      poolReservesAfter.quote.raw,
      state.curve.migrationQuoteThresholdAtomic,
    ),
    poolReservesAfter,
  };

  const common = {
    status: unfilledInputAtomic === 0n ? "filled" : "partial",
    nextSqrtPriceQ64x64: curveQuote.nextSqrtPriceQ64x64,
    fees,
    metrics,
  } as const;
  if (direction === "buy") {
    return {
      ...common,
      direction,
      requestedInput: taggedAmount("quote", inputAtomic, state.curve.quoteDecimals),
      consumedInput: taggedAmount("quote", consumedInputAtomic, state.curve.quoteDecimals),
      unfilledInput: taggedAmount("quote", unfilledInputAtomic, state.curve.quoteDecimals),
      output: taggedAmount("base", outputAtomic, state.curve.baseDecimals),
    };
  }
  return {
    ...common,
    direction,
    requestedInput: taggedAmount("base", inputAtomic, state.curve.baseDecimals),
    consumedInput: taggedAmount("base", consumedInputAtomic, state.curve.baseDecimals),
    unfilledInput: taggedAmount("base", unfilledInputAtomic, state.curve.baseDecimals),
    output: taggedAmount("quote", outputAtomic, state.curve.quoteDecimals),
  };
}

function executeTrade(direction: "buy" | "sell", inputAtomic: bigint, input: PoolState): PoolState {
  const state = requireBondingState(input);
  const trade = quoteTrade(direction, inputAtomic, state);
  if (trade.consumedInput.amount.raw === 0n) {
    throw new RangeError("Trade cannot execute because the curve filled no input");
  }
  const feePlacement = resolveFeePlacement(direction, state.fees.collectFeeMode);
  const feeAmount = totalFee(trade.fees);
  const curveInputAtomic =
    feePlacement.chargedOn === "input"
      ? trade.consumedInput.amount.raw - feeAmount
      : trade.consumedInput.amount.raw;
  const curveOutputAtomic =
    feePlacement.chargedOn === "output"
      ? trade.output.amount.raw + feeAmount
      : trade.output.amount.raw;
  const pool =
    direction === "buy"
      ? {
          base: subtractAmount(state.ledger.pool.base, curveOutputAtomic, "base reserve"),
          quote: addAmount(state.ledger.pool.quote, curveInputAtomic, "quote reserve"),
        }
      : {
          base: addAmount(state.ledger.pool.base, curveInputAtomic, "base reserve"),
          quote: subtractAmount(state.ledger.pool.quote, curveOutputAtomic, "quote reserve"),
        };
  const distributedBase =
    direction === "buy"
      ? state.supply.baseDistributed.amount.raw + curveOutputAtomic
      : state.supply.baseDistributed.amount.raw - curveInputAtomic;

  if (distributedBase < 0n || distributedBase > state.supply.totalBaseSupply.amount.raw) {
    throw new RangeError("Trade would move base distribution outside total base supply");
  }

  const tradingFeeAsset = trade.fees.tradingFee.asset;
  const creatorFeeRaw =
    (trade.fees.tradingFee.amount.raw * state.fees.creatorTradingFeeShareBps) / BASIS_POINTS;
  const partnerFeeRaw = trade.fees.tradingFee.amount.raw - creatorFeeRaw;
  const ledgerFees = {
    totalTrading: addPairAmount(
      state.ledger.fees.totalTrading,
      tradingFeeAsset,
      trade.fees.tradingFee.amount.raw,
    ),
    protocol: addPairAmount(
      state.ledger.fees.protocol,
      trade.fees.protocolFee.asset,
      trade.fees.protocolFee.amount.raw,
    ),
    partner: addPairAmount(state.ledger.fees.partner, tradingFeeAsset, partnerFeeRaw),
    creator: addPairAmount(state.ledger.fees.creator, tradingFeeAsset, creatorFeeRaw),
    referral: addPairAmount(
      state.ledger.fees.referral,
      trade.fees.referralFee.asset,
      trade.fees.referralFee.amount.raw,
    ),
  };

  const migrationAccounting = calculateMigrationQuoteAccounting(
    pool.quote.raw,
    state.curve.migrationQuoteThresholdAtomic,
  );
  const creatorSurplusRaw =
    (migrationAccounting.surplus.partnerCreatorAtomic * state.fees.creatorTradingFeeShareBps) /
    BASIS_POINTS;
  const ledger = {
    ...state.ledger,
    pool,
    fees: ledgerFees,
    surplus: {
      protocol: taggedAmount(
        "quote",
        migrationAccounting.surplus.protocolAtomic,
        state.curve.quoteDecimals,
      ),
      partner: taggedAmount(
        "quote",
        migrationAccounting.surplus.partnerCreatorAtomic - creatorSurplusRaw,
        state.curve.quoteDecimals,
      ),
      creator: taggedAmount("quote", creatorSurplusRaw, state.curve.quoteDecimals),
    },
  };
  const dynamicFeeState = updateDynamicFeeState(state, trade.nextSqrtPriceQ64x64);
  const nextState: PoolState = {
    ...state,
    ledger,
    supply: {
      ...state.supply,
      baseDistributed: {
        asset: "base",
        amount: currencyAmount(distributedBase, state.curve.baseDecimals),
      },
    },
    currentSqrtPriceQ64x64: trade.nextSqrtPriceQ64x64,
    migrationProgress: migrationAccounting.curveComplete ? "curve-complete" : "bonding",
    hasSwapped: true,
    ...(dynamicFeeState ? { dynamicFeeState } : {}),
  };
  const validation = validatePoolState(nextState);
  if (validation.status === "invalid") {
    throw new RangeError(
      validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  return validation.value;
}

function requireBondingState(input: PoolState): PoolState {
  const state = requireValidState(input);
  if (state.migrationProgress !== "bonding") {
    throw new RangeError("Trades are only allowed while the DBC curve is bonding");
  }
  if (state.ledger.pool.quote.raw >= state.curve.migrationQuoteThresholdAtomic) {
    throw new RangeError("The DBC curve is complete and cannot accept more trades");
  }
  return state;
}

function requireValidState(input: PoolState): PoolState {
  const validation = validatePoolState(input);
  if (validation.status === "invalid") {
    throw new RangeError(
      validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  return validation.value;
}

function stateAtClock(state: PoolState, clock: SimulationClock): PoolState {
  if (
    typeof clock.slot !== "bigint" ||
    typeof clock.timestampSeconds !== "bigint" ||
    clock.slot < state.clock.slot ||
    clock.timestampSeconds < state.clock.timestampSeconds
  ) {
    throw new RangeError("Simulation trade clocks must be non-decreasing non-negative bigints");
  }
  return requireValidState({ ...state, clock });
}

function projectedPoolReserves(
  direction: "buy" | "sell",
  state: PoolState,
  quote: ReturnType<typeof quoteCurveBuy>,
): AssetAmountPair {
  return direction === "buy"
    ? {
        base: subtractAmount(state.ledger.pool.base, quote.outputAtomic, "base reserve"),
        quote: addAmount(state.ledger.pool.quote, quote.consumedInputAtomic, "quote reserve"),
      }
    : {
        base: addAmount(state.ledger.pool.base, quote.consumedInputAtomic, "base reserve"),
        quote: subtractAmount(state.ledger.pool.quote, quote.outputAtomic, "quote reserve"),
      };
}

function migrationProgressBps(quoteReserveAtomic: bigint, thresholdAtomic: bigint): bigint {
  return calculateMigrationQuoteAccounting(quoteReserveAtomic, thresholdAtomic).progressBps;
}

function calculatePriceImpactBps(before: Decimal, after: Decimal): bigint {
  return BigInt(
    after.minus(before).abs().mul(BASIS_POINTS.toString()).div(before).floor().toFixed(0),
  );
}

function calculateDrawdownBps(peak: Decimal, current: Decimal): bigint {
  if (!peak.greaterThan(current)) return 0n;
  return BigInt(peak.minus(current).mul(BASIS_POINTS.toString()).div(peak).floor().toFixed(0));
}

function feeDelta(finalState: PoolState, initialState: PoolState): AssetAmountPair {
  const finalPairs = [
    finalState.ledger.fees.totalTrading,
    finalState.ledger.fees.protocol,
    finalState.ledger.fees.referral,
  ];
  const initialPairs = [
    initialState.ledger.fees.totalTrading,
    initialState.ledger.fees.protocol,
    initialState.ledger.fees.referral,
  ];
  const finalBase = finalPairs.reduce((total, pair) => total + pair.base.raw, 0n);
  const initialBase = initialPairs.reduce((total, pair) => total + pair.base.raw, 0n);
  const finalQuote = finalPairs.reduce((total, pair) => total + pair.quote.raw, 0n);
  const initialQuote = initialPairs.reduce((total, pair) => total + pair.quote.raw, 0n);
  return {
    base: currencyAmount(finalBase - initialBase, finalState.curve.baseDecimals),
    quote: currencyAmount(finalQuote - initialQuote, finalState.curve.quoteDecimals),
  };
}

function subtractAssetAmount<Asset extends AssetSide>(
  finalAmount: AssetAmount<Asset>,
  initialRaw: bigint,
): AssetAmount<Asset> {
  const delta = finalAmount.amount.raw - initialRaw;
  if (delta < 0n) throw new RangeError("Run-level fee accounting cannot be negative");
  return { ...finalAmount, amount: currencyAmount(delta, finalAmount.amount.decimals) };
}

function getConfiguredMigrationFee(
  state: PoolState,
  thresholdAtomic: bigint,
): Readonly<{ partnerFeeAtomic: bigint; creatorFeeAtomic: bigint; quoteDepositAtomic: bigint }> {
  const fee = state.migration.fee;
  if (!fee)
    return { partnerFeeAtomic: 0n, creatorFeeAtomic: 0n, quoteDepositAtomic: thresholdAtomic };

  const quoteDepositAtomic = divideRoundUp(
    thresholdAtomic * (BASIS_POINTS - fee.feeBps),
    BASIS_POINTS,
  );
  const totalFeeAtomic = thresholdAtomic - quoteDepositAtomic;
  const creatorFeeAtomic = (totalFeeAtomic * fee.creatorFeeShareBps) / BASIS_POINTS;
  return {
    partnerFeeAtomic: totalFeeAtomic - creatorFeeAtomic,
    creatorFeeAtomic,
    quoteDepositAtomic,
  };
}

function validateSettlementAmount(amount: CurrencyAmount, decimals: number, label: string): void {
  if (
    typeof amount.raw !== "bigint" ||
    amount.raw < 0n ||
    amount.raw > MAX_CURVE_U64 ||
    amount.decimals !== decimals
  ) {
    throw new RangeError(`${label} must be a non-negative u64 amount with the configured scale`);
  }
}

function resolveTradeFeeNumerator(state: PoolState): bigint {
  const baseFeeNumerator = resolveBaseFeeNumerator(state);
  const dynamicConfig = state.fees.dynamic;
  if (!dynamicConfig) return baseFeeNumerator;
  const dynamicState = state.dynamicFeeState ?? {
    lastUpdateTimestamp: state.clock.timestampSeconds,
    sqrtPriceReferenceQ64x64: state.currentSqrtPriceQ64x64,
    volatilityAccumulator: 0n,
    volatilityReference: 0n,
  };
  const volatilityTimesBinStep = dynamicState.volatilityAccumulator * dynamicConfig.binStepBps;
  const variableFeeNumerator =
    (volatilityTimesBinStep ** 2n * dynamicConfig.variableFeeControl +
      DYNAMIC_FEE_ROUNDING_OFFSET) /
    DYNAMIC_FEE_DENOMINATOR;
  const total = baseFeeNumerator + variableFeeNumerator;
  return total > MAX_DYNAMIC_FEE_NUMERATOR ? MAX_DYNAMIC_FEE_NUMERATOR : total;
}

function resolveBaseFeeNumerator(state: PoolState): bigint {
  if (state.fees.base.kind !== "fixed" && state.activationType !== state.fees.base.clock) {
    throw new RangeError("Fee schedule clock must match the pool activation clock");
  }
  const currentPoint =
    state.activationType === "slot" ? state.clock.slot : state.clock.timestampSeconds;
  if (currentPoint < state.activationPoint) {
    throw new RangeError("The pool is not active at the configured simulation clock");
  }

  let baseFeeNumerator: bigint;
  if (state.fees.base.kind === "fixed") {
    baseFeeNumerator = feeNumeratorFromBps(state.fees.base.feeBps);
  } else {
    const elapsedPeriods = (currentPoint - state.activationPoint) / state.fees.base.periodFrequency;
    const period =
      elapsedPeriods < state.fees.base.periodCount ? elapsedPeriods : state.fees.base.periodCount;
    const startingFeeNumerator = feeNumeratorFromBps(state.fees.base.startingFeeBps);
    if (state.fees.base.kind === "linear") {
      const endingFeeNumerator = feeNumeratorFromBps(state.fees.base.endingFeeBps);
      const reductionPerPeriod =
        (startingFeeNumerator - endingFeeNumerator) / state.fees.base.periodCount;
      baseFeeNumerator = startingFeeNumerator - period * reductionPerPeriod;
    } else {
      const endingFeeNumerator = feeNumeratorFromBps(state.fees.base.endingFeeBps);
      const reductionFactorBps = BigInt(
        new Decimal(10_000)
          .mul(
            new Decimal(1).sub(
              new Decimal(endingFeeNumerator.toString())
                .div(startingFeeNumerator.toString())
                .pow(new Decimal(1).div(state.fees.base.periodCount.toString())),
            ),
          )
          .floor()
          .toFixed(),
      );
      const decayQ64 = Q64_ONE - (reductionFactorBps * Q64_ONE) / BASIS_POINTS;
      baseFeeNumerator = (startingFeeNumerator * powQ64(decayQ64, period)) / Q64_ONE;
    }
  }

  return baseFeeNumerator;
}

function updateDynamicFeeState(
  state: PoolState,
  nextSqrtPriceQ64x64: bigint,
): PoolState["dynamicFeeState"] {
  const config = state.fees.dynamic;
  if (!config) return undefined;

  const existing = state.dynamicFeeState ?? {
    lastUpdateTimestamp: state.clock.timestampSeconds,
    sqrtPriceReferenceQ64x64: state.currentSqrtPriceQ64x64,
    volatilityAccumulator: 0n,
    volatilityReference: 0n,
  };
  const elapsed =
    state.clock.timestampSeconds >= existing.lastUpdateTimestamp
      ? state.clock.timestampSeconds - existing.lastUpdateTimestamp
      : 0n;
  const preSwap =
    elapsed >= config.filterPeriodSeconds
      ? {
          ...existing,
          sqrtPriceReferenceQ64x64: state.currentSqrtPriceQ64x64,
          volatilityReference:
            elapsed < config.decayPeriodSeconds
              ? (existing.volatilityAccumulator * config.reductionFactorBps) / BASIS_POINTS
              : 0n,
        }
      : existing;
  const deltaBins = getDeltaBins(
    preSwap.sqrtPriceReferenceQ64x64,
    nextSqrtPriceQ64x64,
    DEFAULT_DYNAMIC_BIN_STEP_Q64,
  );
  const volatilityAccumulator = preSwap.volatilityReference + deltaBins * BASIS_POINTS;
  return {
    ...preSwap,
    volatilityAccumulator:
      volatilityAccumulator < config.maxVolatilityAccumulator
        ? volatilityAccumulator
        : config.maxVolatilityAccumulator,
    lastUpdateTimestamp:
      deltaBins > 0n ? state.clock.timestampSeconds : preSwap.lastUpdateTimestamp,
  };
}

function getDeltaBins(firstPrice: bigint, secondPrice: bigint, binStepQ64: bigint): bigint {
  if (firstPrice <= 0n || secondPrice <= 0n || binStepQ64 <= 0n) {
    throw new RangeError("Dynamic fee price references and bin step must be positive");
  }
  const upperPrice = firstPrice > secondPrice ? firstPrice : secondPrice;
  const lowerPrice = firstPrice > secondPrice ? secondPrice : firstPrice;
  const priceRatioQ64 = (upperPrice * Q64_ONE) / lowerPrice;
  if (priceRatioQ64 > MAX_CURVE_U128) {
    throw new RangeError("Dynamic fee price ratio exceeds the u128 protocol range");
  }
  return ((priceRatioQ64 - Q64_ONE) / binStepQ64) * 2n;
}

function powQ64(base: bigint, exponent: bigint): bigint {
  let result = Q64_ONE;
  let currentBase = base;
  let remainingExponent = exponent;
  while (remainingExponent > 0n) {
    if ((remainingExponent & 1n) === 1n) result = (result * currentBase) / Q64_ONE;
    currentBase = (currentBase * currentBase) / Q64_ONE;
    remainingExponent >>= 1n;
  }
  return result;
}

function tradeFeeAmounts(
  fee: AppliedTradingFee,
  asset: AssetSide,
  decimals: number,
): TradeFeeAmounts {
  return {
    tradingFee: taggedAmount(asset, fee.tradingFeeAtomic, decimals),
    protocolFee: taggedAmount(asset, fee.protocolFeeAtomic, decimals),
    referralFee: taggedAmount(asset, fee.referralFeeAtomic, decimals),
  };
}

function taggedAmount<Asset extends AssetSide>(
  asset: Asset,
  raw: bigint,
  decimals: number,
): AssetAmount<Asset> {
  return { asset, amount: currencyAmount(raw, decimals) };
}

function addPairAmount(pair: AssetAmountPair, asset: AssetSide, amount: bigint): AssetAmountPair {
  return asset === "base"
    ? { ...pair, base: addAmount(pair.base, amount, "base fee ledger") }
    : { ...pair, quote: addAmount(pair.quote, amount, "quote fee ledger") };
}

function addAmount(amount: CurrencyAmount, delta: bigint, label: string): CurrencyAmount {
  const raw = amount.raw + delta;
  if (delta < 0n || raw > MAX_CURVE_U64) throw new RangeError(`${label} exceeds u64 capacity`);
  return currencyAmount(raw, amount.decimals);
}

function subtractAmount(amount: CurrencyAmount, delta: bigint, label: string): CurrencyAmount {
  const raw = amount.raw - delta;
  if (delta < 0n || raw < 0n) throw new RangeError(`${label} would become negative`);
  return currencyAmount(raw, amount.decimals);
}

function totalFee(fees: TradeFeeAmounts): bigint {
  return fees.tradingFee.amount.raw + fees.protocolFee.amount.raw + fees.referralFee.amount.raw;
}

function validateInputAmount(amount: bigint): void {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_CURVE_U64) {
    throw new RangeError("Swap input must be a non-negative u64 bigint");
  }
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function validateResultAmounts(
  consumed: bigint,
  unfilled: bigint,
  output: bigint,
  fee: AppliedTradingFee,
): void {
  const amounts = [
    consumed,
    unfilled,
    output,
    fee.grossAmountAtomic,
    fee.netAmountAtomic,
    fee.totalFeeAtomic,
    fee.tradingFeeAtomic,
    fee.protocolFeeAtomic,
    fee.referralFeeAtomic,
  ];
  if (amounts.some((amount) => amount < 0n || amount > MAX_CURVE_U64)) {
    throw new RangeError("Trade result exceeds the protocol u64 amount range");
  }
}
