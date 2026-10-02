import {
  ActivationType,
  BaseFeeMode,
  calculateBaseToQuoteFromAmountIn,
  calculateQuoteToBaseFromAmountIn,
  buildCurveWithCustomSqrtPrices,
  bpsToFeeNumerator,
  CollectFeeMode,
  fromDecimalToBN,
  getFeeMode,
  getMigrationThresholdPrice,
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getSwapResultFromExactInput,
  validateLPPercentages,
  validateMinimumLockedLiquidity,
  MigrationFeeOption,
  MigrationOption,
  Rounding,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  TradeDirection as SdkTradeDirection,
  validateCurve,
  type ConfigParameters,
  type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { baseDistributedForSegments, quoteRequiredForSegments } from "./segment-math.js";
import { quoteBuy, quoteSell } from "./curve-swap.js";
import type { CurveSegment, DbcCurve } from "./curve.js";
import { feeNumeratorFromBps, feeOnIncludedAmount, resolveFeePlacement } from "./fee-math.js";
import { Q64_ONE } from "./price.js";

function sdkInteger(value: bigint): ReturnType<typeof fromDecimalToBN> {
  return fromDecimalToBN(new Decimal(value.toString()));
}

type SdkCurveEntry = Readonly<{
  sqrtPrice: ReturnType<typeof sdkInteger>;
  liquidity: ReturnType<typeof sdkInteger>;
}>;

function buildSdkCurve(segmentCount: number, collectFeeMode = CollectFeeMode.QuoteToken) {
  const sqrtPrices = Array.from({ length: segmentCount + 1 }, (_, index) =>
    sdkInteger(BigInt(index + 1) * Q64_ONE),
  );

  const parameters = buildCurveWithCustomSqrtPrices({
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
      collectFeeMode,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 5,
      partnerLiquidityPercentage: 45,
      creatorPermanentLockedLiquidityPercentage: 5,
      creatorLiquidityPercentage: 45,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices,
  });

  return { parameters, sqrtPrices };
}

function toDomainCurve(parameters: ConfigParameters): DbcCurve {
  const curveEntries = parameters.curve as SdkCurveEntry[];
  let lowerSqrtPriceQ64x64 = BigInt(parameters.sqrtStartPrice.toString());
  const segments: CurveSegment[] = curveEntries.map((entry) => {
    const segment = {
      lowerSqrtPriceQ64x64,
      upperSqrtPriceQ64x64: BigInt(entry.sqrtPrice.toString()),
      liquidity: BigInt(entry.liquidity.toString()),
    };
    lowerSqrtPriceQ64x64 = segment.upperSqrtPriceQ64x64;
    return segment;
  });

  return {
    baseDecimals: 9,
    quoteDecimals: 6,
    startSqrtPriceQ64x64: BigInt(parameters.sqrtStartPrice.toString()),
    migrationQuoteThresholdAtomic: BigInt(parameters.migrationQuoteThreshold.toString()),
    segments,
  };
}

describe("generated curve parity with Meteora DBC SDK 1.5.13", () => {
  it("preserves raw Q64.64 boundaries and exactly matches generated curve calculations", () => {
    for (let segmentCount = 1; segmentCount <= 16; segmentCount += 1) {
      const { parameters, sqrtPrices } = buildSdkCurve(segmentCount);
      const curve = toDomainCurve(parameters);
      const curveEntries = parameters.curve as SdkCurveEntry[];
      const lastBoundary = sqrtPrices[sqrtPrices.length - 1];

      expect(parameters.sqrtStartPrice.toString()).toBe(sqrtPrices[0]?.toString());
      expect(curveEntries.map((entry) => entry.sqrtPrice.toString())).toEqual(
        sqrtPrices.slice(1).map((price) => price.toString()),
      );
      expect(validateCurve(curveEntries, parameters.sqrtStartPrice)).toBe(true);
      expect(validateLPPercentages(45, 5, 45, 5, 0, 0)).toBe(true);
      expect(validateMinimumLockedLiquidity(5, 5, undefined, undefined)).toBe(true);

      const sdkQuoteBySegment = curveEntries.reduce((total, entry, index) => {
        const lower = sqrtPrices[index];
        if (!lower) throw new Error("Generated curve boundary is missing");
        return (
          total +
          BigInt(
            getDeltaAmountQuoteUnsigned(
              lower,
              entry.sqrtPrice,
              entry.liquidity,
              Rounding.Up,
            ).toString(),
          )
        );
      }, 0n);
      const sdkBaseBySegment = curveEntries.reduce((total, entry, index) => {
        const lower = sqrtPrices[index];
        if (!lower) throw new Error("Generated curve boundary is missing");
        return (
          total +
          BigInt(
            getDeltaAmountBaseUnsigned(
              lower,
              entry.sqrtPrice,
              entry.liquidity,
              Rounding.Down,
            ).toString(),
          )
        );
      }, 0n);

      expect(quoteRequiredForSegments(curve.segments)).toBe(sdkQuoteBySegment);
      expect(baseDistributedForSegments(curve.segments)).toBe(sdkBaseBySegment);

      const buyInput = sdkQuoteBySegment / 2n;
      const localBuy = quoteBuy(curve, buyInput);
      const sdkBuy = calculateQuoteToBaseFromAmountIn(
        { curve: curveEntries },
        parameters.sqrtStartPrice,
        sdkInteger(buyInput),
        lastBoundary,
      );

      expect(localBuy.outputAtomic.toString()).toBe(sdkBuy.outputAmount.toString());
      expect(localBuy.consumedInputAtomic.toString()).toBe(
        (buyInput - BigInt(sdkBuy.amountLeft.toString())).toString(),
      );
      expect(localBuy.nextSqrtPriceQ64x64.toString()).toBe(sdkBuy.nextSqrtPrice.toString());

      const sellInput = sdkBaseBySegment / 2n;
      const localSell = quoteSell(curve, sellInput, BigInt(lastBoundary.toString()));
      const sdkSell = calculateBaseToQuoteFromAmountIn(
        {
          curve: curveEntries,
          sqrtStartPrice: parameters.sqrtStartPrice,
        },
        lastBoundary,
        sdkInteger(sellInput),
      );

      expect(localSell.outputAtomic.toString()).toBe(sdkSell.outputAmount.toString());
      expect(localSell.consumedInputAtomic.toString()).toBe(
        (sellInput - BigInt(sdkSell.amountLeft.toString())).toString(),
      );
      expect(localSell.nextSqrtPriceQ64x64.toString()).toBe(sdkSell.nextSqrtPrice.toString());
    }
  });

  it("matches fixed-fee buys and sells for both quote-token and output-token collection", () => {
    const { parameters } = buildSdkCurve(3);
    const curve = toDomainCurve(parameters);
    const allQuoteInput = quoteRequiredForSegments(curve.segments);
    const allBaseInput = baseDistributedForSegments(curve.segments);
    const buyAmount = allQuoteInput / 2n;
    const sellAmount = allBaseInput / 2n;
    const sellStartPrice = curve.segments[2]?.upperSqrtPriceQ64x64;
    if (sellStartPrice === undefined) throw new Error("Generated sell boundary is missing");
    const migrationSqrtPrice = getMigrationThresholdPrice(
      parameters.migrationQuoteThreshold,
      parameters.sqrtStartPrice,
      parameters.curve as SdkCurveEntry[],
    );
    const feeNumerator = feeNumeratorFromBps(100n);

    for (const direction of ["buy", "sell"] as const) {
      for (const collectionMode of ["quote", "output"] as const) {
        const collectFeeMode =
          collectionMode === "quote" ? CollectFeeMode.QuoteToken : CollectFeeMode.OutputToken;
        const tradeDirection =
          direction === "buy" ? SdkTradeDirection.QuoteToBase : SdkTradeDirection.BaseToQuote;
        const placement = resolveFeePlacement(direction, collectionMode);
        const requestedInput = direction === "buy" ? buyAmount : sellAmount;
        const currentPrice = direction === "buy" ? curve.startSqrtPriceQ64x64 : sellStartPrice;
        const inputFee =
          placement.chargedOn === "input"
            ? feeOnIncludedAmount(requestedInput, feeNumerator)
            : undefined;
        const curveInput = inputFee?.netAmountAtomic ?? requestedInput;
        const localCurveQuote =
          direction === "buy"
            ? quoteBuy(curve, curveInput, currentPrice)
            : quoteSell(curve, curveInput, currentPrice);
        const appliedFee =
          inputFee ?? feeOnIncludedAmount(localCurveQuote.outputAtomic, feeNumerator);
        const localOutput =
          placement.chargedOn === "input"
            ? localCurveQuote.outputAtomic
            : appliedFee.netAmountAtomic;
        const sdkConfig = {
          ...parameters,
          collectFeeMode,
          migrationSqrtPrice,
          poolFees: {
            ...parameters.poolFees,
            dynamicFee: { initialized: 0, binStep: 1, variableFeeControl: 0 },
          },
        } as unknown as Parameters<typeof getSwapResultFromExactInput>[1];
        const volatilityTracker = {
          lastUpdateTimestamp: sdkInteger(0n),
          sqrtPriceReference: sdkInteger(0n),
          volatilityAccumulator: sdkInteger(0n),
          volatilityReference: sdkInteger(0n),
          padding: [],
        };
        const virtualPool = {
          poolState: {
            sqrtPrice: sdkInteger(currentPrice),
            activationPoint: sdkInteger(0n),
            volatilityTracker,
          },
        } as unknown as VirtualPool;
        const sdkQuote = getSwapResultFromExactInput(
          virtualPool,
          sdkConfig,
          sdkInteger(requestedInput),
          getFeeMode(collectFeeMode, tradeDirection, false),
          tradeDirection,
          sdkInteger(0n),
          false,
        );

        expect(bpsToFeeNumerator(100).toString()).toBe(feeNumerator.toString());
        expect(sdkQuote.excludedFeeInputAmount.toString()).toBe(curveInput.toString());
        expect(sdkQuote.outputAmount.toString()).toBe(localOutput.toString());
        expect(sdkQuote.nextSqrtPrice.toString()).toBe(
          localCurveQuote.nextSqrtPriceQ64x64.toString(),
        );
        expect(sdkQuote.tradingFee.toString()).toBe(appliedFee.tradingFeeAtomic.toString());
        expect(sdkQuote.protocolFee.toString()).toBe(appliedFee.protocolFeeAtomic.toString());
        expect(sdkQuote.referralFee.toString()).toBe(appliedFee.referralFeeAtomic.toString());
      }
    }
  });
});
