import { describe, expect, it } from "vitest";
import { validateSolverCandidateCurveWithSdk } from "./solver-sdk-validation.js";
import { Q64_ONE } from "./price.js";

const validCurve = {
  baseDecimals: 9,
  quoteDecimals: 6,
  startSqrtPriceQ64x64: Q64_ONE,
  migrationQuoteThresholdAtomic: 2n,
  segments: [
    {
      lowerSqrtPriceQ64x64: Q64_ONE,
      upperSqrtPriceQ64x64: 2n * Q64_ONE,
      liquidity: Q64_ONE,
    },
    {
      lowerSqrtPriceQ64x64: 2n * Q64_ONE,
      upperSqrtPriceQ64x64: 3n * Q64_ONE,
      liquidity: Q64_ONE,
    },
  ],
};

describe("validateSolverCandidateCurveWithSdk", () => {
  it("records the pinned SDK validation evidence for a generated curve", () => {
    const result = validateSolverCandidateCurveWithSdk(validCurve);

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.evidence.sdkVersion).toBe("1.5.13");
      expect(result.evidence.curveEntryCount).toBe(2);
      expect(result.evidence.startSqrtPriceQ64x64).toBe(Q64_ONE);
      expect(result.evidence.terminalSqrtPriceQ64x64).toBe(3n * Q64_ONE);
    }
  });

  it("rejects a curve that the SDK validator does not accept", () => {
    const result = validateSolverCandidateCurveWithSdk({
      ...validCurve,
      segments: validCurve.segments.map((segment, index) =>
        index === 0 ? { ...segment, liquidity: 0n } : segment,
      ),
    });

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map(({ code }) => code)).toContain("meteora_sdk_curve_rejected");
    }
  });
});
