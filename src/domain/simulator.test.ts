import {
  BaseFeeMode,
  BIN_STEP_BPS_U128_DEFAULT,
  fromDecimalToBN,
  getBaseFeeNumeratorByPeriod,
  getFeeOnAmount,
  getFeeSchedulerParams,
  getVariableFeeNumerator,
  MAX_FEE_NUMERATOR,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import type { DynamicFeeConfiguration, FeeConfiguration } from "./fees.js";
import type { DynamicFeeState, PoolState } from "./pool-state.js";
import { Q64_ONE } from "./price.js";
import { quoteRequiredForSegments } from "./segment-math.js";
import {
  executeBuy,
  executeMigration,
  executeSell,
  getMigrationProgress,
  getPoolEconomicSnapshot,
  getSpotPrice,
  quoteBuy,
  quoteSell,
  runDeterministicSimulation,
} from "./simulator.js";

type StateOptions = Readonly<{
  collectFeeMode?: FeeConfiguration["collectFeeMode"];
  baseFee?: FeeConfiguration["base"];
  dynamicFee?: DynamicFeeConfiguration;
  dynamicFeeState?: DynamicFeeState;
  migrationThreshold?: bigint;
  liquidity?: bigint;
  currentPrice?: bigint;
  quoteReserve?: bigint;
  baseDistributed?: bigint;
  clockSlot?: bigint;
  clockTimestamp?: bigint;
  activationPoint?: bigint;
  activationType?: PoolState["activationType"];
}>;

function makeState(options: StateOptions = {}): PoolState {
  const baseDecimals = 9;
  const quoteDecimals = 6;
  const totalBaseSupply = 20_000n;
  const zeroPair = {
    base: { raw: 0n, decimals: baseDecimals },
    quote: { raw: 0n, decimals: quoteDecimals },
  };
  const zeroQuote = { asset: "quote" as const, amount: zeroPair.quote };
  const zeroBase = { asset: "base" as const, amount: zeroPair.base };
  const liquidity = options.liquidity ?? 2_000n * Q64_ONE;
  const state: PoolState = {
    curve: {
      baseDecimals,
      quoteDecimals,
      startSqrtPriceQ64x64: Q64_ONE,
      migrationQuoteThresholdAtomic: options.migrationThreshold ?? 2_000n,
      segments: [
        {
          lowerSqrtPriceQ64x64: Q64_ONE,
          upperSqrtPriceQ64x64: 2n * Q64_ONE,
          liquidity,
        },
      ],
    },
    fees: {
      base: options.baseFee ?? { kind: "fixed", feeBps: 100n },
      ...(options.dynamicFee ? { dynamic: options.dynamicFee } : {}),
      collectFeeMode: options.collectFeeMode ?? "quote",
      creatorTradingFeeShareBps: 2_500n,
    },
    migration: { destination: "damm-v2" },
    supply: {
      mode: "dynamic",
      totalBaseSupply: {
        asset: "base",
        amount: { raw: totalBaseSupply, decimals: baseDecimals },
      },
      baseDistributed: {
        asset: "base",
        amount: { raw: options.baseDistributed ?? 0n, decimals: baseDecimals },
      },
    },
    ledger: {
      pool: {
        base: { raw: totalBaseSupply, decimals: baseDecimals },
        quote: { raw: options.quoteReserve ?? 0n, decimals: quoteDecimals },
      },
      fees: {
        totalTrading: zeroPair,
        protocol: zeroPair,
        partner: zeroPair,
        creator: zeroPair,
        referral: zeroPair,
      },
      surplus: { protocol: zeroQuote, partner: zeroQuote, creator: zeroQuote },
      migration: {
        partnerFee: zeroQuote,
        creatorFee: zeroQuote,
        protocolLiquidityFee: zeroPair,
        dammLiquidity: zeroPair,
      },
      leftoverBase: zeroBase,
    },
    currentSqrtPriceQ64x64: options.currentPrice ?? Q64_ONE,
    clock: {
      slot: options.clockSlot ?? 0n,
      timestampSeconds: options.clockTimestamp ?? 0n,
    },
    activationPoint: options.activationPoint ?? 0n,
    activationType: options.activationType ?? "slot",
    migrationProgress: "bonding",
    hasSwapped: false,
    ...(options.dynamicFeeState ? { dynamicFeeState: options.dynamicFeeState } : {}),
  };
  return state;
}

function makeSixteenSegmentState(): PoolState {
  const step = Q64_ONE / 100n;
  const liquidity = 1_000n * Q64_ONE;
  const segments = Array.from({ length: 16 }, (_, index) => ({
    lowerSqrtPriceQ64x64: Q64_ONE + BigInt(index) * step,
    upperSqrtPriceQ64x64: Q64_ONE + BigInt(index + 1) * step,
    liquidity,
  }));
  const migrationQuoteThresholdAtomic = quoteRequiredForSegments(segments);
  const state = makeState({
    collectFeeMode: "output",
    migrationThreshold: migrationQuoteThresholdAtomic,
    liquidity,
  });
  return {
    ...state,
    curve: { ...state.curve, segments, migrationQuoteThresholdAtomic },
  };
}

function makeMigrationReadyState(withFee = false): PoolState {
  const state = executeBuy(
    5_000n,
    makeState({ collectFeeMode: "output", liquidity: 20n * Q64_ONE, migrationThreshold: 20n }),
  );
  return {
    ...state,
    migration: {
      ...state.migration,
      ...(withFee ? { fee: { feeBps: 2_500n, creatorFeeShareBps: 5_000n } } : {}),
      liquidityAllocation: {
        creator: { unlockedBps: 7_000n, permanentlyLockedBps: 1_000n, vestingBps: 1_000n },
        partner: { unlockedBps: 1_000n, permanentlyLockedBps: 0n, vestingBps: 0n },
      },
    },
  };
}

function makeMigrationSettlement(
  state: PoolState,
  quoteLiquidity: bigint,
): {
  protocolLiquidityFee: PoolState["ledger"]["migration"]["protocolLiquidityFee"];
  dammLiquidity: PoolState["ledger"]["migration"]["dammLiquidity"];
  leftoverBase: PoolState["ledger"]["leftoverBase"];
  liquidityUnits: bigint;
} {
  return {
    protocolLiquidityFee: {
      base: { raw: 0n, decimals: state.curve.baseDecimals },
      quote: { raw: 0n, decimals: state.curve.quoteDecimals },
    },
    dammLiquidity: {
      base: state.ledger.pool.base,
      quote: { raw: quoteLiquidity, decimals: state.curve.quoteDecimals },
    },
    leftoverBase: {
      asset: "base",
      amount: { raw: 0n, decimals: state.curve.baseDecimals },
    },
    liquidityUnits: 11n,
  };
}

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

function sumFees(result: ReturnType<typeof quoteBuy> | ReturnType<typeof quoteSell>): bigint {
  return (
    result.fees.tradingFee.amount.raw +
    result.fees.protocolFee.amount.raw +
    result.fees.referralFee.amount.raw
  );
}

describe("deterministic DBC trade simulation", () => {
  it("quotes without mutation and applies a quote-token fee to buy input", () => {
    const state = makeState();
    const before = structuredClone(state);
    const quote = quoteBuy(1_000n, state);

    expect(state).toEqual(before);
    expect(quote.direction).toBe("buy");
    expect(quote.status).toBe("filled");
    expect(quote.requestedInput).toEqual({
      asset: "quote",
      amount: { raw: 1_000n, decimals: 6 },
    });
    expect(quote.consumedInput.amount.raw).toBe(1_000n);
    expect(quote.unfilledInput.amount.raw).toBe(0n);
    expect(quote.fees.tradingFee.amount.raw + quote.fees.protocolFee.amount.raw).toBe(10n);

    const next = executeBuy(1_000n, state);
    expect(state).toEqual(before);
    expect(next.ledger.pool.quote.raw).toBe(990n);
    expect(next.ledger.pool.base.raw).toBe(20_000n - quote.output.amount.raw);
    expect(next.supply.baseDistributed.amount.raw).toBe(quote.output.amount.raw);
    expect(next.currentSqrtPriceQ64x64).toBe(quote.nextSqrtPriceQ64x64);
    expect(next.ledger.fees.totalTrading.quote.raw).toBe(8n);
    expect(next.ledger.fees.protocol.quote.raw).toBe(2n);
    expect(next.ledger.fees.creator.quote.raw).toBe(2n);
    expect(next.ledger.fees.partner.quote.raw).toBe(6n);
    expect(next.hasSwapped).toBe(true);
  });

  it("exposes deterministic reserve, supply, fee, spot-price, and migration metrics", () => {
    const state = makeState();
    const next = executeBuy(1_000n, state);
    const snapshot = getPoolEconomicSnapshot(next);

    expect(snapshot.poolReserves).toEqual(next.ledger.pool);
    expect(snapshot.baseDistributed).toEqual(next.supply.baseDistributed);
    expect(snapshot.feesGenerated.base.raw).toBe(0n);
    expect(snapshot.feesGenerated.quote.raw).toBe(10n);
    expect(snapshot.spotPrice.comparedTo("1000")).toBe(1);
    expect(snapshot.migrationProgressBps).toBe(4_950n);
    expect(snapshot.migrationProgress).toBe("bonding");

    const migratedToThreshold = executeBuy(
      5_000n,
      makeState({ liquidity: 20n * Q64_ONE, migrationThreshold: 20n }),
    );
    const completedSnapshot = getPoolEconomicSnapshot(migratedToThreshold);

    expect(completedSnapshot.migrationProgressBps).toBe(10_000n);
    expect(completedSnapshot.migrationProgress).toBe("curve-complete");
  });

  it("reports per-trade and reproducible full-run metrics", () => {
    const initialState = makeState();
    const input = {
      id: "stable-run",
      initialState,
      trades: [
        {
          direction: "buy" as const,
          inputAtomic: 1_000n,
          clock: { slot: 1n, timestampSeconds: 10n },
        },
        {
          direction: "sell" as const,
          inputAtomic: 20n,
          clock: { slot: 2n, timestampSeconds: 20n },
        },
      ],
    };
    const first = runDeterministicSimulation(input);
    const second = runDeterministicSimulation(input);

    expect(first).toEqual(second);
    expect(first.status).toBe("completed");
    expect(first.startedAtSeconds).toBe(0n);
    expect(first.completedAtSeconds).toBe(20n);
    expect(first.trades[0]?.metrics.spotPriceBefore.eq(getSpotPrice(initialState))).toBe(true);
    expect(first.trades[0]?.metrics.spotPriceAfter.greaterThan(getSpotPrice(initialState))).toBe(
      true,
    );
    expect(first.trades[0]?.metrics.poolReservesAfter.quote.raw).toBe(990n);
    expect(first.trades[0]?.metrics.migrationProgressAfterBps).toBe(4_950n);
    expect(first.metrics.quoteAccumulated.amount.raw).toBe(first.finalState.ledger.pool.quote.raw);
    expect(first.metrics.maximumPriceImpactBps).toBeGreaterThan(0n);
    expect(first.metrics.maximumDrawdownBps).toBeGreaterThan(0n);
    expect(getMigrationProgress(first.finalState).comparedTo("1")).toBeLessThan(0);
  });

  it.each([
    ["buy", "quote", 1_000n],
    ["buy", "output", 1_000n],
    ["sell", "quote", 100n],
    ["sell", "output", 100n],
  ] as const)("quotes and executes a %s with %s-token fee collection", (direction, mode, input) => {
    const state =
      direction === "buy"
        ? makeState({ collectFeeMode: mode })
        : makeState({
            collectFeeMode: mode,
            currentPrice: (3n * Q64_ONE) / 2n,
            quoteReserve: 1_000n,
            baseDistributed: 1_000n,
          });
    const quote = direction === "buy" ? quoteBuy(input, state) : quoteSell(input, state);
    const next = direction === "buy" ? executeBuy(input, state) : executeSell(input, state);

    expect(quote.fees.tradingFee.asset).toBe(
      mode === "quote" || direction === "sell" ? "quote" : "base",
    );
    expect(quote.output.amount.raw).toBeGreaterThan(0n);
    expect(next.currentSqrtPriceQ64x64).toBe(quote.nextSqrtPriceQ64x64);
    expect(quote.metrics.poolReservesAfter).toEqual(next.ledger.pool);
    expect(next.ledger.fees.totalTrading[quote.fees.tradingFee.asset].raw).toBe(
      quote.fees.tradingFee.amount.raw,
    );
    expect(
      next.ledger.fees.creator[quote.fees.tradingFee.asset].raw +
        next.ledger.fees.partner[quote.fees.tradingFee.asset].raw,
    ).toBe(quote.fees.tradingFee.amount.raw);
  });

  it("partially fills at the migration price, completes the curve, and rejects later trades", () => {
    const state = makeState({
      collectFeeMode: "output",
      liquidity: 20n * Q64_ONE,
      migrationThreshold: 20n,
    });
    const quote = quoteBuy(5_000n, state);

    expect(quote.status).toBe("partial");
    expect(quote.consumedInput.amount.raw + quote.unfilledInput.amount.raw).toBe(5_000n);
    expect(quote.nextSqrtPriceQ64x64).toBe(2n * Q64_ONE);
    expect(quote.fees.tradingFee.asset).toBe("base");

    const next = executeBuy(5_000n, state);
    expect(next.ledger.pool.quote.raw).toBe(20n);
    expect(next.migrationProgress).toBe("curve-complete");
    expect(next.ledger.surplus.protocol.amount.raw).toBe(0n);
    expect(() => quoteBuy(1n, next)).toThrow(RangeError);
    expect(() => executeSell(1n, next)).toThrow(RangeError);

    const quoteFeeState = makeState({
      collectFeeMode: "quote",
      liquidity: 20n * Q64_ONE,
      migrationThreshold: 20n,
    });
    const quoteFeeResult = quoteBuy(5_000n, quoteFeeState);
    expect(quoteFeeResult.consumedInput.amount.raw).toBe(21n);
    expect(quoteFeeResult.unfilledInput.amount.raw).toBe(4_979n);
    expect(sumFees(quoteFeeResult)).toBe(1n);
    expect(executeBuy(5_000n, quoteFeeState).ledger.pool.quote.raw).toBe(20n);
  });

  it("buys and sells across the maximum configured 16 curve segments", () => {
    const state = makeSixteenSegmentState();
    const threshold = state.curve.migrationQuoteThresholdAtomic;
    const partialBuy = executeBuy(threshold - 1n, state);

    expect(partialBuy.migrationProgress).toBe("bonding");
    expect(partialBuy.currentSqrtPriceQ64x64).toBeGreaterThan(
      state.curve.segments[14]?.upperSqrtPriceQ64x64 ?? 0n,
    );
    const sellQuote = quoteSell(partialBuy.supply.baseDistributed.amount.raw, partialBuy);
    const afterSell = executeSell(partialBuy.supply.baseDistributed.amount.raw, partialBuy);

    expect(sellQuote.output.amount.raw).toBeGreaterThan(0n);
    expect(sellQuote.nextSqrtPriceQ64x64).toBeLessThan(partialBuy.currentSqrtPriceQ64x64);
    expect(afterSell.currentSqrtPriceQ64x64).toBe(sellQuote.nextSqrtPriceQ64x64);

    const fullBuy = quoteBuy(threshold + 1_000n, makeSixteenSegmentState());
    expect(fullBuy.status).toBe("partial");
    expect(fullBuy.nextSqrtPriceQ64x64).toBe(state.curve.segments[15]?.upperSqrtPriceQ64x64);
  });

  it("settles migration ledgers, allocates liquidity units, and locks post-migration trading", () => {
    const state = makeMigrationReadyState(true);
    const settlement = makeMigrationSettlement(state, 15n);
    const result = executeMigration(state, settlement);

    expect(result.verificationStatus).toBe("unverified");
    expect(result.state.migrationProgress).toBe("locked-vesting");
    expect(result.state.ledger.pool.base.raw).toBe(0n);
    expect(result.state.ledger.pool.quote.raw).toBe(0n);
    expect(result.state.ledger.migration.partnerFee.amount.raw).toBe(3n);
    expect(result.state.ledger.migration.creatorFee.amount.raw).toBe(2n);
    expect(result.state.ledger.migration.dammLiquidity.quote.raw).toBe(15n);
    expect(result.liquidityAllocation.distributableLiquidity).toBe(11n);
    expect(
      result.liquidityAllocation.creator.unlocked +
        result.liquidityAllocation.creator.permanentlyLocked +
        result.liquidityAllocation.creator.vesting +
        result.liquidityAllocation.partner.unlocked +
        result.liquidityAllocation.partner.permanentlyLocked +
        result.liquidityAllocation.partner.vesting,
    ).toBe(11n);
    expect(() => executeBuy(1n, result.state)).toThrow(
      "only allowed while the DBC curve is bonding",
    );
    expect(() => executeSell(1n, result.state)).toThrow(
      "only allowed while the DBC curve is bonding",
    );
    expect(() => executeMigration(result.state, settlement)).toThrow(
      "only allowed after the DBC curve is complete",
    );
  });

  it("rejects migration settlements that fail asset conservation", () => {
    const state = makeMigrationReadyState();
    const settlement = makeMigrationSettlement(state, state.curve.migrationQuoteThresholdAtomic);

    expect(() =>
      executeMigration(state, {
        ...settlement,
        dammLiquidity: {
          ...settlement.dammLiquidity,
          quote: { raw: settlement.dammLiquidity.quote.raw - 1n, decimals: 6 },
        },
      }),
    ).toThrow("does not conserve quote");
  });

  it("includes migration surplus and allocation in the complete-run metrics", () => {
    const initialState = makeMigrationReadyState(true);
    const settlement = makeMigrationSettlement(initialState, 15n);
    const result = runDeterministicSimulation({
      id: "migration-run",
      initialState,
      trades: [],
      migrationSettlement: settlement,
    });

    expect(result.metrics.migrated).toBe(true);
    expect(result.metrics.quoteAccumulated.amount.raw).toBe(20n);
    expect(result.metrics.migrationFees.creator.amount.raw).toBe(2n);
    expect(result.metrics.migrationFees.partner.amount.raw).toBe(3n);
    expect(result.metrics.liquidityAllocation?.distributableLiquidity).toBe(11n);
    expect(result.verificationStatus).toBe("unverified");
  });

  it("does not execute a trade when the curve fills no input", () => {
    const state = makeState({ currentPrice: Q64_ONE });
    const quote = quoteSell(100n, state);

    expect(quote.status).toBe("partial");
    expect(quote.consumedInput.amount.raw).toBe(0n);
    expect(() => executeSell(100n, state)).toThrow("filled no input");
  });

  it.each([
    ["linear", BaseFeeMode.FeeSchedulerLinear],
    ["exponential", BaseFeeMode.FeeSchedulerExponential],
  ] as const)("matches the pinned SDK %s fee scheduler", (kind, sdkMode) => {
    const state = makeState({
      baseFee: {
        kind,
        startingFeeBps: 100n,
        endingFeeBps: 25n,
        periodCount: 3n,
        periodFrequency: 2n,
        clock: "slot",
      },
      clockSlot: 4n,
    });
    const params = getFeeSchedulerParams(100, 25, sdkMode, 3, 6);
    const period = sdkInteger(2n);
    const feeNumerator = getBaseFeeNumeratorByPeriod(
      params.cliffFeeNumerator,
      params.firstFactor,
      period,
      params.thirdFactor,
      params.baseFeeMode,
    );
    const expected = getFeeOnAmount(
      feeNumerator,
      sdkInteger(1_000n),
      undefined as unknown as Parameters<typeof getFeeOnAmount>[2],
      false,
    );
    const quote = quoteBuy(1_000n, state);

    expect(sumFees(quote)).toBe(
      BigInt(expected.tradingFee.toString()) + BigInt(expected.protocolFee.toString()),
    );
  });

  it("adds the dynamic fee and updates the volatility snapshot after execution", () => {
    const dynamicFee: DynamicFeeConfiguration = {
      binStepBps: 1n,
      filterPeriodSeconds: 10n,
      decayPeriodSeconds: 20n,
      reductionFactorBps: 5_000n,
      maxVolatilityAccumulator: 1_000_000n,
      variableFeeControl: 1_000_000n,
    };
    const state = makeState({
      dynamicFee,
      dynamicFeeState: {
        lastUpdateTimestamp: 85n,
        sqrtPriceReferenceQ64x64: Q64_ONE,
        volatilityAccumulator: 1_000_000n,
        volatilityReference: 0n,
      },
      clockTimestamp: 100n,
      activationType: "timestamp",
    });
    const quote = quoteBuy(1_000n, state);
    const next = executeBuy(1_000n, state);
    const sdkDynamicFee = {
      initialized: 1,
      binStep: 1,
      variableFeeControl: 1_000_000,
    } as unknown as Parameters<typeof getVariableFeeNumerator>[0];
    const sdkVolatility = {
      volatilityAccumulator: sdkInteger(1_000_000n),
    } as unknown as Parameters<typeof getVariableFeeNumerator>[1];
    const variableFeeNumerator = BigInt(
      getVariableFeeNumerator(sdkDynamicFee, sdkVolatility).toString(),
    );
    const totalFeeNumerator =
      10_000_000n + variableFeeNumerator > BigInt(MAX_FEE_NUMERATOR)
        ? BigInt(MAX_FEE_NUMERATOR)
        : 10_000_000n + variableFeeNumerator;
    const sdkFees = getFeeOnAmount(
      sdkInteger(totalFeeNumerator),
      sdkInteger(1_000n),
      undefined as unknown as Parameters<typeof getFeeOnAmount>[2],
      false,
    );
    const priceRatioQ64 = (next.currentSqrtPriceQ64x64 * Q64_ONE) / Q64_ONE;
    const deltaBins =
      ((priceRatioQ64 - Q64_ONE) / BigInt(BIN_STEP_BPS_U128_DEFAULT.toString())) * 2n;
    const sdkCappedAccumulator =
      500_000n + deltaBins * 10_000n > dynamicFee.maxVolatilityAccumulator
        ? dynamicFee.maxVolatilityAccumulator
        : 500_000n + deltaBins * 10_000n;

    expect(sumFees(quote)).toBe(
      BigInt(sdkFees.tradingFee.toString()) + BigInt(sdkFees.protocolFee.toString()),
    );
    expect(next.dynamicFeeState?.sqrtPriceReferenceQ64x64).toBe(Q64_ONE);
    expect(next.dynamicFeeState?.volatilityReference).toBe(500_000n);
    expect(next.dynamicFeeState?.lastUpdateTimestamp).toBe(100n);
    expect(next.dynamicFeeState?.volatilityAccumulator).toBe(sdkCappedAccumulator);
  });
});
