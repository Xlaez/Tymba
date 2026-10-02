import { describe, expect, it } from "vitest";
import { MAX_CURVE_U64, MAX_CURVE_U128 } from "./curve.js";
import type { PoolState } from "./pool-state.js";
import { validatePoolState } from "./pool-state-validation.js";
import { Q64_ONE } from "./price.js";

type MutableDeep<Value> = Value extends bigint | number | string | boolean | null | undefined
  ? Value
  : Value extends readonly (infer Element)[]
    ? MutableDeep<Element>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: MutableDeep<Value[Key]> }
      : Value;

function validState(): MutableDeep<PoolState> {
  const baseAmount = { raw: 0n, decimals: 9 };
  const quoteAmount = { raw: 0n, decimals: 6 };
  const pair = { base: baseAmount, quote: quoteAmount };
  const quoteAssetAmount = { asset: "quote" as const, amount: quoteAmount };

  return {
    curve: {
      baseDecimals: 9,
      quoteDecimals: 6,
      startSqrtPriceQ64x64: Q64_ONE,
      migrationQuoteThresholdAtomic: 1n,
      segments: [
        {
          lowerSqrtPriceQ64x64: Q64_ONE,
          upperSqrtPriceQ64x64: 2n * Q64_ONE,
          liquidity: Q64_ONE,
        },
      ],
    },
    fees: {
      base: { kind: "fixed", feeBps: 25n },
      collectFeeMode: "quote",
      creatorTradingFeeShareBps: 0n,
    },
    migration: { destination: "damm-v2" },
    supply: {
      mode: "dynamic",
      totalBaseSupply: { asset: "base", amount: { raw: MAX_CURVE_U64, decimals: 9 } },
      baseDistributed: { asset: "base", amount: baseAmount },
    },
    ledger: {
      pool: pair,
      fees: {
        totalTrading: pair,
        protocol: pair,
        partner: pair,
        creator: pair,
        referral: pair,
      },
      surplus: {
        protocol: quoteAssetAmount,
        partner: quoteAssetAmount,
        creator: quoteAssetAmount,
      },
      migration: {
        partnerFee: quoteAssetAmount,
        creatorFee: quoteAssetAmount,
        protocolLiquidityFee: pair,
        dammLiquidity: pair,
      },
      leftoverBase: { asset: "base", amount: baseAmount },
    },
    currentSqrtPriceQ64x64: Q64_ONE,
    clock: { slot: 0n, timestampSeconds: 0n },
    activationPoint: 0n,
    activationType: "slot",
    migrationProgress: "bonding",
    hasSwapped: false,
  };
}

function mutableState(): MutableDeep<PoolState> {
  return structuredClone(validState());
}

describe("validatePoolState", () => {
  it("accepts a complete in-memory state and returns a detached snapshot", () => {
    const input = mutableState();
    const result = validatePoolState(input);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;

    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
    expect(result.value.curve).not.toBe(input.curve);
    expect(result.value.ledger).not.toBe(input.ledger);

    const segment = input.curve.segments[0];
    if (segment) segment.liquidity = 2n * Q64_ONE;
    expect(result.value.curve.segments[0]?.liquidity).toBe(Q64_ONE);
  });

  it("rejects invalid protocol amounts, asset scales, and out-of-curve prices", () => {
    const invalidAmount = mutableState();
    invalidAmount.ledger.pool.base.raw = MAX_CURVE_U64 + 1n;
    const amountResult = validatePoolState(invalidAmount);
    expect(amountResult.status).toBe("invalid");
    if (amountResult.status === "invalid") {
      expect(amountResult.issues).toContainEqual(
        expect.objectContaining({ path: "$.ledger.pool.base.raw", code: "out_of_range" }),
      );
    }

    const invalidScale = mutableState();
    invalidScale.ledger.pool.quote.decimals = 9;
    const scaleResult = validatePoolState(invalidScale);
    expect(scaleResult.status).toBe("invalid");
    if (scaleResult.status === "invalid") {
      expect(scaleResult.issues).toContainEqual(
        expect.objectContaining({ path: "$.ledger.pool.quote.decimals", code: "decimal_mismatch" }),
      );
    }

    const invalidPrice = mutableState();
    invalidPrice.currentSqrtPriceQ64x64 = MAX_CURVE_U128;
    const priceResult = validatePoolState(invalidPrice);
    expect(priceResult.status).toBe("invalid");
    if (priceResult.status === "invalid") {
      expect(priceResult.issues).toContainEqual(
        expect.objectContaining({ path: "$.currentSqrtPriceQ64x64", code: "price_outside_curve" }),
      );
    }
  });

  it("rejects supply over-distribution, mismatched asset tags, and dangling dynamic state", () => {
    const oversupply = mutableState();
    oversupply.supply.totalBaseSupply.amount.raw = 1n;
    oversupply.supply.baseDistributed.amount.raw = 2n;
    const oversupplyResult = validatePoolState(oversupply);
    expect(oversupplyResult.status).toBe("invalid");
    if (oversupplyResult.status === "invalid") {
      expect(oversupplyResult.issues).toContainEqual(
        expect.objectContaining({
          path: "$.supply.baseDistributed.amount.raw",
          code: "supply_exceeded",
        }),
      );
    }

    const mismatch = mutableState();
    Reflect.set(mismatch.ledger.surplus.creator, "asset", "base");
    const mismatchResult = validatePoolState(mismatch);
    expect(mismatchResult.status).toBe("invalid");
    if (mismatchResult.status === "invalid") {
      expect(mismatchResult.issues).toContainEqual(
        expect.objectContaining({ path: "$.ledger.surplus.creator.asset", code: "asset_mismatch" }),
      );
    }

    const danglingDynamicState = {
      ...validState(),
      dynamicFeeState: {
        lastUpdateTimestamp: 0n,
        sqrtPriceReferenceQ64x64: Q64_ONE,
        volatilityAccumulator: 0n,
        volatilityReference: 0n,
      },
    };
    expect(validatePoolState(danglingDynamicState).status).toBe("invalid");
  });

  it("enforces scheduled-fee clock and dynamic u128 state bounds", () => {
    const clockMismatch = mutableState();
    clockMismatch.fees.base = {
      kind: "linear",
      startingFeeBps: 100n,
      endingFeeBps: 25n,
      periodCount: 3n,
      periodFrequency: 10n,
      clock: "timestamp",
    };
    const clockResult = validatePoolState(clockMismatch);
    expect(clockResult.status).toBe("invalid");
    if (clockResult.status === "invalid") {
      expect(clockResult.issues).toContainEqual(
        expect.objectContaining({ path: "$.activationType", code: "fee_clock_mismatch" }),
      );
    }

    const dynamicState = {
      ...validState(),
      fees: {
        ...validState().fees,
        dynamic: {
          binStepBps: 1n,
          filterPeriodSeconds: 10n,
          decayPeriodSeconds: 20n,
          reductionFactorBps: 5_000n,
          maxVolatilityAccumulator: 1_000_000n,
          variableFeeControl: 1_000n,
        },
      },
      dynamicFeeState: {
        lastUpdateTimestamp: 0n,
        sqrtPriceReferenceQ64x64: Q64_ONE,
        volatilityAccumulator: MAX_CURVE_U128 + 1n,
        volatilityReference: 0n,
      },
    };
    const dynamicResult = validatePoolState(dynamicState);
    expect(dynamicResult.status).toBe("invalid");
    if (dynamicResult.status === "invalid") {
      expect(dynamicResult.issues).toContainEqual(
        expect.objectContaining({
          path: "$.dynamicFeeState.volatilityAccumulator",
          code: "out_of_range",
        }),
      );
    }
  });

  it("rejects lifecycle status that conflicts with pool reserves", () => {
    const incomplete = mutableState();
    incomplete.migrationProgress = "curve-complete";
    const incompleteResult = validatePoolState(incomplete);
    expect(incompleteResult.status).toBe("invalid");
    if (incompleteResult.status === "invalid") {
      expect(incompleteResult.issues).toContainEqual(
        expect.objectContaining({
          path: "$.migrationProgress",
          code: "migration_status_mismatch",
        }),
      );
    }

    const migrated = mutableState();
    migrated.migrationProgress = "migrated";
    migrated.ledger.pool.base.raw = 1n;
    const migratedResult = validatePoolState(migrated);
    expect(migratedResult.status).toBe("invalid");
    if (migratedResult.status === "invalid") {
      expect(migratedResult.issues).toContainEqual(
        expect.objectContaining({
          path: "$.ledger.pool",
          code: "post_migration_reserve",
        }),
      );
      expect(migratedResult.issues).toContainEqual(
        expect.objectContaining({
          path: "$.ledger.migration.dammLiquidity",
          code: "missing_migrated_liquidity",
        }),
      );
    }
  });

  it("rejects a migration threshold beyond the configured curve capacity", () => {
    const input = mutableState();
    input.curve.migrationQuoteThresholdAtomic = 2n;
    const result = validatePoolState(input);

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          path: "$.curve.migrationQuoteThresholdAtomic",
          code: "threshold_exceeds_curve_capacity",
        }),
      );
    }
  });
});
