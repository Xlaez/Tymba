import { currencyAmount, parseCurrencyAmount } from "../src/domain/currency-amount.js";
import type { DbcCurve, CurveSegment } from "../src/domain/curve.js";
import { priceToSqrtPriceQ64x64, Q128_SCALE } from "../src/domain/price.js";
import { quoteRequiredForSegments } from "../src/domain/segment-math.js";
import type { PoolState } from "../src/domain/pool-state.js";
import type {
  DeterministicSimulationInput,
  DeterministicTradeInput,
  MigrationSettlement,
} from "../src/domain/simulator.js";
import { executeBuy, runDeterministicSimulation } from "../src/domain/simulator.js";
import type { MarketIntent } from "../src/domain/market-intent.js";
import { validateMarketIntent } from "../src/domain/market-intent.js";

export const DEMO_FIXTURE_STATUS = "illustrative-not-solver-output";
export const DEMO_SETTLEMENT_STATUS = "illustrative-not-migration-parity-verified";
export const demoFixtureAssumptions = {
  baseFeeBps: 100n,
  collectFeeMode: "output" as const,
  creatorTradingFeeShareBps: 2_500n,
  protocolLiquidityFeeBps: 20n,
  liquidityUnits: 1_000_000_000_000n,
  liquidityAllocation: {
    creator: { unlockedBps: 4_000n, permanentlyLockedBps: 2_000n, vestingBps: 1_000n },
    partner: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 0n },
  },
} as const;

export const demoMarketIntent: MarketIntent = {
  assets: {
    base: { symbol: "MKT", decimals: 9 },
    quote: { symbol: "USDC", decimals: 6 },
  },
  supply: { totalBase: "1000000000" },
  pricing: { startFdv: "200000", migrationFdv: "2000000" },
  targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
  preferences: { launchProfile: "balanced", sniperResistance: "high" },
  solver: { maxSegments: 3 },
};

const demoSegmentSpecifications = [
  { upperPrice: "0.00035", quoteBudget: "25000" },
  { upperPrice: "0.0008", quoteBudget: "50000" },
  { upperPrice: "0.002", quoteBudget: "75000" },
] as const;

export const demoTrades: readonly DeterministicTradeInput[] = [
  { direction: "buy", inputAtomic: 25_000_000_000n, clock: { slot: 1n, timestampSeconds: 1n } },
  { direction: "buy", inputAtomic: 50_000_000_000n, clock: { slot: 2n, timestampSeconds: 2n } },
  { direction: "buy", inputAtomic: 50_000_000_000n, clock: { slot: 3n, timestampSeconds: 3n } },
  { direction: "buy", inputAtomic: 50_000_000_000n, clock: { slot: 4n, timestampSeconds: 4n } },
];

export function createDemoPoolState(): PoolState {
  const intentResult = validateMarketIntent(demoMarketIntent);
  if (intentResult.status === "invalid") {
    throw new RangeError(intentResult.issues.map((issue) => issue.message).join("; "));
  }

  const { normalized } = intentResult;
  const startSqrtPriceQ64x64 = priceToSqrtPriceQ64x64(
    normalized.startPrice.toString(),
    normalized.baseDecimals,
    normalized.quoteDecimals,
  );
  const boundaries = [
    startSqrtPriceQ64x64,
    ...demoSegmentSpecifications.map((segment) =>
      priceToSqrtPriceQ64x64(segment.upperPrice, normalized.baseDecimals, normalized.quoteDecimals),
    ),
  ];
  const segments = buildDemoSegments(boundaries, normalized.quoteDecimals);
  const migrationQuoteThresholdAtomic = quoteRequiredForSegments(segments);
  if (migrationQuoteThresholdAtomic !== normalized.quoteToMigrationAtomic) {
    throw new RangeError("Demo curve segment budgets do not equal the canonical quote target");
  }

  const baseZero = currencyAmount(0n, normalized.baseDecimals);
  const quoteZero = currencyAmount(0n, normalized.quoteDecimals);
  const baseSupply = currencyAmount(normalized.totalBaseAtomic, normalized.baseDecimals);
  const pair = { base: baseZero, quote: quoteZero };
  const quoteAmount = { asset: "quote" as const, amount: quoteZero };
  const baseAmount = { asset: "base" as const, amount: baseZero };
  const curve: DbcCurve = {
    baseDecimals: normalized.baseDecimals,
    quoteDecimals: normalized.quoteDecimals,
    startSqrtPriceQ64x64,
    migrationQuoteThresholdAtomic,
    segments,
  };

  return {
    curve,
    fees: {
      base: { kind: "fixed", feeBps: demoFixtureAssumptions.baseFeeBps },
      collectFeeMode: demoFixtureAssumptions.collectFeeMode,
      creatorTradingFeeShareBps: demoFixtureAssumptions.creatorTradingFeeShareBps,
    },
    migration: {
      destination: "damm-v2",
      allocationIntent: {
        creatorLockedBps: 3_000n,
        partnerLockedBps: 2_000n,
        unlockedBps: 5_000n,
        lockDurationSeconds: 86_400n,
      },
      liquidityAllocation: demoFixtureAssumptions.liquidityAllocation,
    },
    supply: {
      mode: "fixed",
      totalBaseSupply: { asset: "base", amount: baseSupply },
      baseDistributed: { asset: "base", amount: baseZero },
    },
    ledger: {
      pool: {
        base: baseSupply,
        quote: currencyAmount(0n, normalized.quoteDecimals),
      },
      fees: {
        totalTrading: pair,
        protocol: pair,
        partner: pair,
        creator: pair,
        referral: pair,
      },
      surplus: {
        protocol: quoteAmount,
        partner: quoteAmount,
        creator: quoteAmount,
      },
      migration: {
        partnerFee: quoteAmount,
        creatorFee: quoteAmount,
        protocolLiquidityFee: pair,
        dammLiquidity: pair,
      },
      leftoverBase: baseAmount,
    },
    currentSqrtPriceQ64x64: startSqrtPriceQ64x64,
    clock: { slot: 0n, timestampSeconds: 0n },
    activationPoint: 0n,
    activationType: "slot",
    migrationProgress: "bonding",
    hasSwapped: false,
  };
}

export function createDemoSimulationInput(): DeterministicSimulationInput {
  const initialState = createDemoPoolState();
  let completedCurveState = initialState;
  for (const trade of demoTrades) {
    completedCurveState = executeBuy(trade.inputAtomic, {
      ...completedCurveState,
      clock: trade.clock ?? completedCurveState.clock,
    });
  }

  const protocolQuoteFee =
    (completedCurveState.ledger.pool.quote.raw * demoFixtureAssumptions.protocolLiquidityFeeBps) /
    10_000n;
  const protocolBaseFee =
    (completedCurveState.ledger.pool.base.raw * demoFixtureAssumptions.protocolLiquidityFeeBps) /
    10_000n;
  const migrationSettlement: MigrationSettlement = {
    protocolLiquidityFee: {
      base: currencyAmount(protocolBaseFee, completedCurveState.curve.baseDecimals),
      quote: currencyAmount(protocolQuoteFee, completedCurveState.curve.quoteDecimals),
    },
    dammLiquidity: {
      base: currencyAmount(
        completedCurveState.ledger.pool.base.raw - protocolBaseFee,
        completedCurveState.curve.baseDecimals,
      ),
      quote: currencyAmount(
        completedCurveState.ledger.pool.quote.raw - protocolQuoteFee,
        completedCurveState.curve.quoteDecimals,
      ),
    },
    leftoverBase: {
      asset: "base",
      amount: currencyAmount(0n, completedCurveState.curve.baseDecimals),
    },
    liquidityUnits: demoFixtureAssumptions.liquidityUnits,
  };

  return {
    id: "tymba-phase3-demo-market",
    initialState,
    trades: demoTrades,
    migrationSettlement,
  };
}

export function runDemoSimulation() {
  return runDeterministicSimulation(createDemoSimulationInput());
}

function buildDemoSegments(
  boundaries: readonly bigint[],
  quoteDecimals: number,
): readonly CurveSegment[] {
  if (boundaries.length !== demoSegmentSpecifications.length + 1) {
    throw new RangeError("Demo curve boundary count does not match the scripted segment count");
  }

  return demoSegmentSpecifications.map((specification, index) => {
    const lower = boundaries[index];
    const upper = boundaries[index + 1];
    if (lower === undefined || upper === undefined || upper <= lower) {
      throw new RangeError("Demo curve prices must be increasing");
    }
    const quoteBudgetAtomic = parseCurrencyAmount(specification.quoteBudget, quoteDecimals).raw;
    const liquidity = ((quoteBudgetAtomic - 1n) * Q128_SCALE) / (upper - lower) + 1n;
    return {
      lowerSqrtPriceQ64x64: lower,
      upperSqrtPriceQ64x64: upper,
      liquidity,
    };
  });
}
