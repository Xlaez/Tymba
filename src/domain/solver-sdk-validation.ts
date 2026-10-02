import { validateCurve, fromDecimalToBN } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Decimal } from "decimal.js";
import type { DbcCurve } from "./curve.js";

export const PINNED_METEORA_DBC_SDK_VERSION = "1.5.13";

export type SdkCurveValidationEvidence = Readonly<{
  sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
  curveEntryCount: number;
  startSqrtPriceQ64x64: bigint;
  terminalSqrtPriceQ64x64: bigint;
}>;

export type SdkCurveValidationIssue = Readonly<{
  code: string;
  message: string;
}>;

export type SdkCurveValidationResult =
  | Readonly<{ status: "valid"; evidence: SdkCurveValidationEvidence }>
  | Readonly<{ status: "invalid"; issues: readonly SdkCurveValidationIssue[] }>;

export function validateSolverCandidateCurveWithSdk(curve: DbcCurve): SdkCurveValidationResult {
  if (!Array.isArray(curve.segments) || curve.segments.length === 0) {
    return {
      status: "invalid",
      issues: [
        {
          code: "sdk_curve_empty",
          message: "Meteora SDK candidate curve must contain at least one entry",
        },
      ],
    };
  }

  const terminalSqrtPriceQ64x64 = curve.segments.at(-1)?.upperSqrtPriceQ64x64;
  if (terminalSqrtPriceQ64x64 === undefined) {
    return {
      status: "invalid",
      issues: [
        {
          code: "sdk_curve_terminal_price_missing",
          message: "Meteora SDK candidate curve has no terminal sqrt-price boundary",
        },
      ],
    };
  }

  try {
    const sdkCurve = curve.segments.map((segment) => ({
      sqrtPrice: fromDecimalToBN(new Decimal(segment.upperSqrtPriceQ64x64.toString())),
      liquidity: fromDecimalToBN(new Decimal(segment.liquidity.toString())),
    }));
    const sdkStartPrice = fromDecimalToBN(new Decimal(curve.startSqrtPriceQ64x64.toString()));
    if (!validateCurve(sdkCurve, sdkStartPrice)) {
      return {
        status: "invalid",
        issues: [
          {
            code: "meteora_sdk_curve_rejected",
            message: "Pinned Meteora DBC SDK validateCurve rejected the generated candidate curve",
          },
        ],
      };
    }
  } catch (error) {
    return {
      status: "invalid",
      issues: [
        {
          code: "meteora_sdk_curve_validation_failed",
          message:
            error instanceof Error
              ? error.message
              : "Pinned Meteora DBC SDK curve validation failed",
        },
      ],
    };
  }

  return {
    status: "valid",
    evidence: {
      sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
      curveEntryCount: curve.segments.length,
      startSqrtPriceQ64x64: curve.startSqrtPriceQ64x64,
      terminalSqrtPriceQ64x64,
    },
  };
}
