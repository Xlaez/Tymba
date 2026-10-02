import { describe, expect, it } from "vitest";
import {
  createDemoPoolState,
  DEMO_FIXTURE_STATUS,
  DEMO_SETTLEMENT_STATUS,
  demoMarketIntent,
  demoTrades,
  runDemoSimulation,
} from "./demo-market.js";

describe("Phase 3 demo market fixture", () => {
  it("matches the canonical Tymba intent and validates its illustrative three-segment state", () => {
    const state = createDemoPoolState();

    expect(demoMarketIntent.assets).toEqual({
      base: { symbol: "MKT", decimals: 9 },
      quote: { symbol: "USDC", decimals: 6 },
    });
    expect(state.curve.segments).toHaveLength(3);
    expect(state.curve.migrationQuoteThresholdAtomic).toBe(150_000_000_000n);
    expect(DEMO_FIXTURE_STATUS).toBe("illustrative-not-solver-output");
    expect(DEMO_SETTLEMENT_STATUS).toBe("illustrative-not-migration-parity-verified");
    expect(demoTrades).toHaveLength(4);
  });

  it("runs reproducibly through migration and reports target-adjacent metrics without claiming parity", () => {
    const first = runDemoSimulation();
    const second = runDemoSimulation();

    expect(first).toEqual(second);
    expect(first.status).toBe("partial");
    expect(first.trades.at(-1)?.unfilledInput.amount.raw).toBeGreaterThan(0n);
    expect(first.metrics.migrated).toBe(true);
    expect(first.metrics.quoteAccumulated.amount.raw).toBe(150_000_000_000n);
    expect(first.metrics.baseDistributedBps).toBeGreaterThanOrEqual(2_400n);
    expect(first.metrics.baseDistributedBps).toBeLessThanOrEqual(2_600n);
    expect(first.metrics.liquidityAllocation?.distributableLiquidity).toBe(1_000_000_000_000n);
    expect(first.verificationStatus).toBe("unverified");
    expect(first.finalState.migrationProgress).toBe("locked-vesting");
  });
});
