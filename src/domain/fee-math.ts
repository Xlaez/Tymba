import { MAX_CURVE_U64 } from "./curve.js";
import type { FeeCollectionMode } from "./fees.js";

export const DBC_FEE_DENOMINATOR = 1_000_000_000n;
export const MAX_DBC_FEE_NUMERATOR = 990_000_000n;
export const DBC_FEE_NUMERATOR_PER_BPS = 100_000n;

export type TradeDirection = "buy" | "sell";

export type FeePlacement = Readonly<{
  asset: "base" | "quote";
  chargedOn: "input" | "output";
}>;

export type AppliedTradingFee = Readonly<{
  grossAmountAtomic: bigint;
  netAmountAtomic: bigint;
  totalFeeAtomic: bigint;
  tradingFeeAtomic: bigint;
  protocolFeeAtomic: bigint;
  referralFeeAtomic: bigint;
}>;

export function feeNumeratorFromBps(feeBps: bigint): bigint {
  if (typeof feeBps !== "bigint" || feeBps < 0n || feeBps > 9_900n) {
    throw new RangeError("Fee basis points must be between 0 and 9900");
  }
  return feeBps * DBC_FEE_NUMERATOR_PER_BPS;
}

export function feeOnIncludedAmount(
  grossAmountAtomic: bigint,
  feeNumerator: bigint,
  hasReferral = false,
): AppliedTradingFee {
  validateAmount(grossAmountAtomic);
  validateFeeNumerator(feeNumerator);
  const totalFeeAtomic = divideRoundUp(grossAmountAtomic * feeNumerator, DBC_FEE_DENOMINATOR);
  return buildFeeResult(
    grossAmountAtomic,
    grossAmountAtomic - totalFeeAtomic,
    totalFeeAtomic,
    hasReferral,
  );
}

export function grossUpExcludedAmount(
  netAmountAtomic: bigint,
  feeNumerator: bigint,
  hasReferral = false,
): AppliedTradingFee {
  validateAmount(netAmountAtomic);
  validateFeeNumerator(feeNumerator);
  const grossAmountAtomic = divideRoundUp(
    netAmountAtomic * DBC_FEE_DENOMINATOR,
    DBC_FEE_DENOMINATOR - feeNumerator,
  );
  validateAmount(grossAmountAtomic);
  return buildFeeResult(
    grossAmountAtomic,
    netAmountAtomic,
    grossAmountAtomic - netAmountAtomic,
    hasReferral,
  );
}

export function resolveFeePlacement(
  direction: TradeDirection,
  collectionMode: FeeCollectionMode,
): FeePlacement {
  if (direction !== "buy" && direction !== "sell") {
    throw new TypeError("Trade direction must be buy or sell");
  }
  if (collectionMode !== "quote" && collectionMode !== "output") {
    throw new TypeError("Fee collection mode must be quote or output");
  }

  const asset = collectionMode === "quote" || direction === "sell" ? "quote" : "base";
  const inputAsset = direction === "buy" ? "quote" : "base";
  return { asset, chargedOn: asset === inputAsset ? "input" : "output" };
}

function buildFeeResult(
  grossAmountAtomic: bigint,
  netAmountAtomic: bigint,
  totalFeeAtomic: bigint,
  hasReferral: boolean,
): AppliedTradingFee {
  const protocolShareBeforeReferral = (totalFeeAtomic * 20n) / 100n;
  const referralFeeAtomic = hasReferral ? (protocolShareBeforeReferral * 20n) / 100n : 0n;
  const protocolFeeAtomic = protocolShareBeforeReferral - referralFeeAtomic;
  const tradingFeeAtomic = totalFeeAtomic - protocolShareBeforeReferral;

  return {
    grossAmountAtomic,
    netAmountAtomic,
    totalFeeAtomic,
    tradingFeeAtomic,
    protocolFeeAtomic,
    referralFeeAtomic,
  };
}

function validateAmount(amount: bigint): void {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_CURVE_U64) {
    throw new RangeError("Fee amount must be a non-negative u64 bigint");
  }
}

function validateFeeNumerator(feeNumerator: bigint): void {
  if (
    typeof feeNumerator !== "bigint" ||
    feeNumerator < 0n ||
    feeNumerator > MAX_DBC_FEE_NUMERATOR
  ) {
    throw new RangeError("Fee numerator must be between 0 and the DBC maximum of 990000000");
  }
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
