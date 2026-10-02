import {
  CollectFeeMode,
  fromDecimalToBN,
  getExcludedFeeAmount,
  getFeeMode,
  getFeeOnAmount,
  getIncludedFeeAmount,
  TradeDirection as SdkTradeDirection,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { MAX_CURVE_U64 } from "./curve.js";
import {
  DBC_FEE_DENOMINATOR,
  DBC_FEE_NUMERATOR_PER_BPS,
  feeNumeratorFromBps,
  feeOnIncludedAmount,
  grossUpExcludedAmount,
  MAX_DBC_FEE_NUMERATOR,
  resolveFeePlacement,
} from "./fee-math.js";

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

const tradeFeeNumerator = 25n * DBC_FEE_NUMERATOR_PER_BPS;
const unusedSdkPoolFees = undefined as unknown as Parameters<typeof getFeeOnAmount>[2];

describe("DBC fixed-fee amount calculations", () => {
  it("converts basis points to the SDK fee-numerator scale", () => {
    expect(feeNumeratorFromBps(25n)).toBe(2_500_000n);
    expect(feeNumeratorFromBps(9_900n)).toBe(MAX_DBC_FEE_NUMERATOR);
    expect(DBC_FEE_DENOMINATOR).toBe(1_000_000_000n);
  });

  it("rounds fees upward on included amounts and matches the pinned SDK", () => {
    const local = feeOnIncludedAmount(10_003n, tradeFeeNumerator);
    const [sdkNet, sdkFee] = getExcludedFeeAmount(
      sdkInteger(tradeFeeNumerator),
      sdkInteger(10_003n),
    );
    const sdkResult = getFeeOnAmount(
      sdkInteger(tradeFeeNumerator),
      sdkInteger(10_003n),
      unusedSdkPoolFees,
      false,
    );

    expect(local.totalFeeAtomic).toBe(26n);
    expect(local.netAmountAtomic.toString()).toBe(sdkNet.toString());
    expect(local.totalFeeAtomic.toString()).toBe(sdkFee.toString());
    expect(local.netAmountAtomic.toString()).toBe(sdkResult.amount.toString());
    expect(local.tradingFeeAtomic.toString()).toBe(sdkResult.tradingFee.toString());
    expect(local.protocolFeeAtomic.toString()).toBe(sdkResult.protocolFee.toString());
    expect(local.referralFeeAtomic.toString()).toBe(sdkResult.referralFee.toString());
  });

  it("grosses up a desired net amount with upward rounding and matches the pinned SDK", () => {
    const local = grossUpExcludedAmount(9_977n, tradeFeeNumerator, true);
    const [sdkGross, sdkFee] = getIncludedFeeAmount(
      sdkInteger(tradeFeeNumerator),
      sdkInteger(9_977n),
    );
    const sdkResult = getFeeOnAmount(
      sdkInteger(tradeFeeNumerator),
      sdkGross,
      unusedSdkPoolFees,
      true,
    );

    expect(local.grossAmountAtomic.toString()).toBe(sdkGross.toString());
    expect(local.totalFeeAtomic.toString()).toBe(sdkFee.toString());
    expect(local.grossAmountAtomic.toString()).toBe(
      sdkResult.amount
        .add(sdkResult.tradingFee)
        .add(sdkResult.protocolFee)
        .add(sdkResult.referralFee)
        .toString(),
    );
    expect(local.netAmountAtomic).toBe(9_977n);
    expect(local.tradingFeeAtomic + local.protocolFeeAtomic + local.referralFeeAtomic).toBe(
      local.totalFeeAtomic,
    );
  });

  it("splits referral share from the protocol fee using SDK rounding", () => {
    const local = feeOnIncludedAmount(10_003n, tradeFeeNumerator, true);
    const sdkResult = getFeeOnAmount(
      sdkInteger(tradeFeeNumerator),
      sdkInteger(10_003n),
      unusedSdkPoolFees,
      true,
    );

    expect(local.tradingFeeAtomic.toString()).toBe(sdkResult.tradingFee.toString());
    expect(local.protocolFeeAtomic.toString()).toBe(sdkResult.protocolFee.toString());
    expect(local.referralFeeAtomic.toString()).toBe(sdkResult.referralFee.toString());
    expect(local.tradingFeeAtomic + local.protocolFeeAtomic + local.referralFeeAtomic).toBe(
      local.totalFeeAtomic,
    );
  });

  it("maps quote/output collection to the correct asset and side", () => {
    const cases = [
      ["buy", "quote", SdkTradeDirection.QuoteToBase, CollectFeeMode.QuoteToken],
      ["buy", "output", SdkTradeDirection.QuoteToBase, CollectFeeMode.OutputToken],
      ["sell", "quote", SdkTradeDirection.BaseToQuote, CollectFeeMode.QuoteToken],
      ["sell", "output", SdkTradeDirection.BaseToQuote, CollectFeeMode.OutputToken],
    ] as const;

    for (const [direction, mode, sdkDirection, sdkMode] of cases) {
      const local = resolveFeePlacement(direction, mode);
      const sdk = getFeeMode(sdkMode, sdkDirection, false);

      expect(local.asset).toBe(sdk.feesOnBaseToken ? "base" : "quote");
      expect(local.chargedOn).toBe(sdk.feesOnInput ? "input" : "output");
    }
  });

  it("rejects values outside the DBC amount and fee bounds", () => {
    expect(() => feeNumeratorFromBps(-1n)).toThrow(RangeError);
    expect(() => feeNumeratorFromBps(9_901n)).toThrow(RangeError);
    expect(() => feeOnIncludedAmount(-1n, tradeFeeNumerator)).toThrow(RangeError);
    expect(() => feeOnIncludedAmount(MAX_CURVE_U64 + 1n, tradeFeeNumerator)).toThrow(RangeError);
    expect(() => feeOnIncludedAmount(1n, MAX_DBC_FEE_NUMERATOR + 1n)).toThrow(RangeError);
    expect(() => grossUpExcludedAmount(1n, DBC_FEE_DENOMINATOR)).toThrow(RangeError);
  });
});
