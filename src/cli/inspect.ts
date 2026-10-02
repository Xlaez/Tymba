import { Decimal } from "decimal.js";
import { formatCurrencyAmount } from "../domain/currency-amount.js";
import type { DbcCurve } from "../domain/curve.js";
import type { DeterministicSimulationResult } from "../domain/simulation.js";
import { migrationSqrtPriceAtThreshold } from "../domain/migration-math.js";
import { sqrtPriceQ64x64ToPrice } from "../domain/price.js";
import { baseDistributedForSegment, quoteRequiredForSegment } from "../domain/segment-math.js";
import {
  runDemoSimulation,
  createDemoPoolState,
  demoMarketIntent,
} from "../../examples/demo-market.js";

const EXACT_DECIMAL = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });

type InspectionSegment = Readonly<{
  number: number;
  lowerPrice: string;
  upperPrice: string;
  priceUnit: string;
  quoteCapital: string;
  quoteAsset: string;
  baseDistributed: string;
  baseAsset: string;
  averageEntryPrice: string;
}>;

type AllocationOwnerSummary = Readonly<{
  totalSharePercentage: string;
  unlockedPercentage: string;
  permanentlyLockedPercentage: string;
  vestingPercentage: string;
}>;

type InspectionData = Readonly<{
  curve: DbcCurve;
  run: DeterministicSimulationResult;
  segments: readonly InspectionSegment[];
  quoteTotal: string;
  baseTotal: string;
  migrationPrice: string;
  migrationFdv: string;
  creatorAllocation?: AllocationOwnerSummary;
  partnerAllocation?: AllocationOwnerSummary;
}>;

export type DemoInspectionDocument = Readonly<{
  schemaVersion: 1;
  kind: "curve-inspection";
  evidence: Readonly<{
    classification: "illustrative-modeled";
    verificationStatus: string;
    note: string;
  }>;
  market: Readonly<{ base: string; quote: string; baseDecimals: number; quoteDecimals: number }>;
  segments: readonly InspectionSegment[];
  totals: Readonly<{
    capitalToTraverse: Readonly<{ amount: string; asset: string }>;
    baseAcrossFullCurve: Readonly<{ amount: string; asset: string }>;
  }>;
  graduation: Readonly<{
    capitalTarget: Readonly<{ amount: string; asset: string }>;
    price: string;
    priceUnit: string;
    fullyDilutedValue: string;
    quoteAsset: string;
  }>;
  scriptedRun: Readonly<{
    status: string;
    migrationStatus: string;
    capitalAccumulatedBeforeMigration: Readonly<{ amount: string; asset: string }>;
    baseSupplyDistributed: Readonly<{ amount: string; asset: string; percentage: string }>;
    tradingFees: Readonly<{ base: string; quote: string }>;
    migrationFees: Readonly<{ partner: string; creator: string }>;
    surplus: Readonly<{ protocol: string; partner: string; creator: string }>;
    postMigrationLiquidityShares?: Readonly<{
      creator: AllocationOwnerSummary;
      partner: AllocationOwnerSummary;
    }>;
  }>;
  advanced?: Readonly<{
    description: string;
    curve: DbcCurve;
    simulation: DeterministicSimulationResult;
  }>;
}>;

export function createDemoInspectionDocument(advanced = false): DemoInspectionDocument {
  const data = collectInspectionData();
  const { base, quote } = demoMarketIntent.assets;
  const metrics = data.run.metrics;
  return {
    schemaVersion: 1,
    kind: "curve-inspection",
    evidence: {
      classification: "illustrative-modeled",
      verificationStatus: data.run.verificationStatus,
      note: "The hand-authored demo curve and migration settlement are illustrative and are not compiled from the JSON intent or verified against Meteora.",
    },
    market: {
      base: base.symbol,
      quote: quote.symbol,
      baseDecimals: base.decimals,
      quoteDecimals: quote.decimals,
    },
    segments: data.segments,
    totals: {
      capitalToTraverse: { amount: data.quoteTotal, asset: quote.symbol },
      baseAcrossFullCurve: { amount: data.baseTotal, asset: base.symbol },
    },
    graduation: {
      capitalTarget: {
        amount: formatCurrencyAmount({
          raw: data.curve.migrationQuoteThresholdAtomic,
          decimals: quote.decimals,
        }),
        asset: quote.symbol,
      },
      price: data.migrationPrice,
      priceUnit: `${quote.symbol}/${base.symbol}`,
      fullyDilutedValue: data.migrationFdv,
      quoteAsset: quote.symbol,
    },
    scriptedRun: {
      status: data.run.status,
      migrationStatus: data.run.finalState.migrationProgress,
      capitalAccumulatedBeforeMigration: {
        amount: formatCurrencyAmount(metrics.quoteAccumulated.amount),
        asset: quote.symbol,
      },
      baseSupplyDistributed: {
        amount: formatCurrencyAmount(metrics.baseDistributed.amount),
        asset: base.symbol,
        percentage: formatBps(metrics.baseDistributedBps),
      },
      tradingFees: {
        base: formatCurrencyAmount(metrics.feesGenerated.base),
        quote: formatCurrencyAmount(metrics.feesGenerated.quote),
      },
      migrationFees: {
        partner: formatCurrencyAmount(metrics.migrationFees.partner.amount),
        creator: formatCurrencyAmount(metrics.migrationFees.creator.amount),
      },
      surplus: {
        protocol: formatCurrencyAmount(metrics.surplus.protocol.amount),
        partner: formatCurrencyAmount(metrics.surplus.partner.amount),
        creator: formatCurrencyAmount(metrics.surplus.creator.amount),
      },
      ...(data.creatorAllocation && data.partnerAllocation
        ? {
            postMigrationLiquidityShares: {
              creator: data.creatorAllocation,
              partner: data.partnerAllocation,
            },
          }
        : {}),
    },
    ...(advanced
      ? {
          advanced: {
            description:
              "Exact raw protocol and simulator state values; integer amounts are atomic units and prices use Q64.64.",
            curve: data.curve,
            simulation: data.run,
          },
        }
      : {}),
  };
}

export function formatDemoInspection(advanced = false): string {
  const document = createDemoInspectionDocument(advanced);
  const lines = [
    "Scripted demo curve inspection",
    "The curve below is illustrative and is not compiled from demo-market.json.",
    "Segment economics:",
    ...document.segments.map(
      (segment) =>
        `${segment.number}. ${segment.lowerPrice} → ${segment.upperPrice} ${segment.priceUnit}; ${segment.quoteCapital} ${segment.quoteAsset} capital; ${segment.baseDistributed} ${segment.baseAsset} distributed; average entry ${segment.averageEntryPrice} ${segment.priceUnit}`,
    ),
    `Curve totals: ${document.totals.capitalToTraverse.amount} ${document.totals.capitalToTraverse.asset} capital; ${document.totals.baseAcrossFullCurve.amount} ${document.totals.baseAcrossFullCurve.asset} across full configured segments`,
    `Graduation: ${document.graduation.capitalTarget.amount} ${document.graduation.capitalTarget.asset} capital target; ${document.graduation.price} ${document.graduation.priceUnit}; ${document.graduation.fullyDilutedValue} ${document.graduation.quoteAsset} fully diluted value`,
    `Scripted-run outcome: ${document.scriptedRun.status}; ${document.scriptedRun.capitalAccumulatedBeforeMigration.amount} ${document.scriptedRun.capitalAccumulatedBeforeMigration.asset} accumulated; ${document.scriptedRun.baseSupplyDistributed.amount} ${document.scriptedRun.baseSupplyDistributed.asset} distributed (${document.scriptedRun.baseSupplyDistributed.percentage}%); migration ${document.scriptedRun.migrationStatus}`,
    `Trading fees: ${document.scriptedRun.tradingFees.quote} ${document.market.quote}; ${document.scriptedRun.tradingFees.base} ${document.market.base}`,
    `Migration fees: ${document.scriptedRun.migrationFees.partner} ${document.market.quote} partner; ${document.scriptedRun.migrationFees.creator} ${document.market.quote} creator`,
    `Surplus: ${document.scriptedRun.surplus.protocol} ${document.market.quote} protocol; ${document.scriptedRun.surplus.partner} ${document.market.quote} partner; ${document.scriptedRun.surplus.creator} ${document.market.quote} creator`,
    `Migration settlement evidence: ${document.evidence.verificationStatus}`,
  ];
  const allocation = document.scriptedRun.postMigrationLiquidityShares;
  if (allocation) {
    lines.push(
      `DAMM liquidity allocation: ${formatAllocationOwner("Creator", allocation.creator)}; ${formatAllocationOwner("partner", allocation.partner)}`,
    );
  }
  if (document.advanced) {
    lines.push("Advanced protocol values:");
    lines.push(
      `Migration quote threshold atomic: ${document.advanced.curve.migrationQuoteThresholdAtomic}`,
    );
    for (const [index, segment] of document.advanced.curve.segments.entries()) {
      lines.push(
        `Segment ${index + 1}: lower sqrt price Q64.64 ${segment.lowerSqrtPriceQ64x64}; upper sqrt price Q64.64 ${segment.upperSqrtPriceQ64x64}; liquidity ${segment.liquidity}; quote atomic ${quoteRequiredForSegment(segment)}; base atomic ${baseDistributedForSegment(segment)}`,
      );
    }
  }
  return lines.join("\n");
}

function collectInspectionData(): InspectionData {
  const state = createDemoPoolState();
  const run = runDemoSimulation();
  const { base, quote } = demoMarketIntent.assets;
  let quoteTotalAtomic = 0n;
  let baseTotalAtomic = 0n;
  const segments = state.curve.segments.map((segment, index) => {
    const quoteAtomic = quoteRequiredForSegment(segment);
    const baseAtomic = baseDistributedForSegment(segment);
    quoteTotalAtomic += quoteAtomic;
    baseTotalAtomic += baseAtomic;
    const lowerPrice = sqrtPriceQ64x64ToPrice(
      segment.lowerSqrtPriceQ64x64,
      base.decimals,
      quote.decimals,
    );
    const upperPrice = sqrtPriceQ64x64ToPrice(
      segment.upperSqrtPriceQ64x64,
      base.decimals,
      quote.decimals,
    );
    return {
      number: index + 1,
      lowerPrice: lowerPrice.toSignificantDigits(8).toString(),
      upperPrice: upperPrice.toSignificantDigits(8).toString(),
      priceUnit: `${quote.symbol}/${base.symbol}`,
      quoteCapital: formatCurrencyAmount({ raw: quoteAtomic, decimals: quote.decimals }),
      quoteAsset: quote.symbol,
      baseDistributed: formatCurrencyAmount({ raw: baseAtomic, decimals: base.decimals }),
      baseAsset: base.symbol,
      averageEntryPrice: averageEntryPrice(quoteAtomic, baseAtomic, quote.decimals, base.decimals)
        .toSignificantDigits(8)
        .toString(),
    };
  });
  const migrationPrice = sqrtPriceQ64x64ToPrice(
    migrationSqrtPriceAtThreshold(state.curve),
    base.decimals,
    quote.decimals,
  );
  const totalBase = new EXACT_DECIMAL(state.supply.totalBaseSupply.amount.raw.toString()).div(
    (10n ** BigInt(base.decimals)).toString(),
  );
  const liquidityAllocation = run.metrics.liquidityAllocation;
  return {
    curve: state.curve,
    run,
    segments,
    quoteTotal: formatCurrencyAmount({ raw: quoteTotalAtomic, decimals: quote.decimals }),
    baseTotal: formatCurrencyAmount({ raw: baseTotalAtomic, decimals: base.decimals }),
    migrationPrice: migrationPrice.toSignificantDigits(8).toString(),
    migrationFdv: migrationPrice.mul(totalBase).toSignificantDigits(8).toString(),
    ...(liquidityAllocation
      ? {
          creatorAllocation: allocationOwnerDocument(
            liquidityAllocation.creator,
            liquidityAllocation.distributableLiquidity,
          ),
          partnerAllocation: allocationOwnerDocument(
            liquidityAllocation.partner,
            liquidityAllocation.distributableLiquidity,
          ),
        }
      : {}),
  };
}

function averageEntryPrice(
  quoteAtomic: bigint,
  baseAtomic: bigint,
  quoteDecimals: number,
  baseDecimals: number,
): Decimal {
  if (baseAtomic === 0n) return new EXACT_DECIMAL(0);
  const scaledQuote = new EXACT_DECIMAL(quoteAtomic.toString()).div(
    (10n ** BigInt(quoteDecimals)).toString(),
  );
  const scaledBase = new EXACT_DECIMAL(baseAtomic.toString()).div(
    (10n ** BigInt(baseDecimals)).toString(),
  );
  return scaledQuote.div(scaledBase);
}

function allocationOwnerDocument(
  allocation: Readonly<{ unlocked: bigint; permanentlyLocked: bigint; vesting: bigint }>,
  total: bigint,
): AllocationOwnerSummary {
  const ownerTotal = allocation.unlocked + allocation.permanentlyLocked + allocation.vesting;
  return {
    totalSharePercentage: ratioPercent(ownerTotal, total),
    unlockedPercentage: ratioPercent(allocation.unlocked, total),
    permanentlyLockedPercentage: ratioPercent(allocation.permanentlyLocked, total),
    vestingPercentage: ratioPercent(allocation.vesting, total),
  };
}

function formatAllocationOwner(name: string, allocation: AllocationOwnerSummary): string {
  return `${name} ${allocation.totalSharePercentage}% (unlocked ${allocation.unlockedPercentage}%, permanently locked ${allocation.permanentlyLockedPercentage}%, vesting ${allocation.vestingPercentage}%)`;
}

function ratioPercent(part: bigint, total: bigint): string {
  if (total === 0n) return "not applicable";
  return new EXACT_DECIMAL(part.toString()).mul(100).div(total.toString()).toFixed(2);
}

function formatBps(value: bigint): string {
  return new EXACT_DECIMAL(value.toString()).div(100).toFixed(2);
}
