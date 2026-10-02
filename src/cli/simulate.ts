import { Decimal } from "decimal.js";
import { demoMarketIntent } from "../../examples/demo-market.js";
import { formatCurrencyAmount } from "../domain/currency-amount.js";
import type { DeterministicSimulationResult } from "../domain/simulation.js";
import type { TradeResult } from "../domain/trade-result.js";

export function formatSimulationReport(
  result: DeterministicSimulationResult,
  advanced = false,
): string {
  const state = result.finalState;
  const { base, quote } = demoMarketIntent.assets;
  const baseSymbol = base.symbol;
  const quoteSymbol = quote.symbol;
  const metrics = result.metrics;
  const lines = [
    `Deterministic demo simulation: ${result.status.toUpperCase()}`,
    "Evidence: modeled; illustrative migration settlement is unverified against Meteora",
    `Trades: ${result.trades.length}`,
    `Capital accumulated before migration: ${formatCurrencyAmount(metrics.quoteAccumulated.amount)} ${quoteSymbol}`,
    `Base supply distributed: ${formatCurrencyAmount(metrics.baseDistributed.amount)} ${baseSymbol} (${formatBps(metrics.baseDistributedBps)}%)`,
    `Graduation price: ${metrics.finalMigrationPrice?.toSignificantDigits(8).toString() ?? "not available"} ${quoteSymbol} per ${baseSymbol}`,
    `Graduation fully diluted value: ${metrics.finalMigrationFdv?.toSignificantDigits(8).toString() ?? "not available"} ${quoteSymbol}`,
    `Final spot price: ${metrics.finalSpotPrice.toSignificantDigits(8).toString()} ${quoteSymbol} per ${baseSymbol}`,
    `Trading fees: ${formatCurrencyAmount(metrics.feesGenerated.quote)} ${quoteSymbol} and ${formatCurrencyAmount(metrics.feesGenerated.base)} ${baseSymbol}`,
    `Migration fees: ${formatCurrencyAmount(metrics.migrationFees.partner.amount)} ${quoteSymbol} to partner; ${formatCurrencyAmount(metrics.migrationFees.creator.amount)} ${quoteSymbol} to creator`,
    `Surplus: ${formatCurrencyAmount(metrics.surplus.protocol.amount)} ${quoteSymbol} protocol; ${formatCurrencyAmount(metrics.surplus.partner.amount)} ${quoteSymbol} partner; ${formatCurrencyAmount(metrics.surplus.creator.amount)} ${quoteSymbol} creator`,
    `Largest trade price movement: ${formatBps(metrics.maximumPriceImpactBps)}%`,
    `Maximum drawdown: ${formatBps(metrics.maximumDrawdownBps)}%`,
    `Migration status: ${state.migrationProgress}`,
  ];

  if (result.trades.some((trade) => trade.status === "partial")) {
    lines.push("Note: an order was partially filled at the curve's graduation limit.");
  }
  if (metrics.liquidityAllocation) {
    lines.push(
      `Post-migration liquidity shares: ${formatAllocationOwner("Creator", metrics.liquidityAllocation.creator, metrics.liquidityAllocation.distributableLiquidity)}; ${formatAllocationOwner("partner", metrics.liquidityAllocation.partner, metrics.liquidityAllocation.distributableLiquidity)}`,
    );
  }

  lines.push("Trade details:");
  for (const [index, trade] of result.trades.entries()) {
    lines.push(formatTrade(trade, index + 1, baseSymbol, quoteSymbol));
  }
  if (advanced) lines.push(...formatAdvancedSimulationValues(result));
  return lines.join("\n");
}

export function createSimulationDocument(
  result: DeterministicSimulationResult,
  advanced = false,
): Readonly<Record<string, unknown>> {
  const { base, quote } = demoMarketIntent.assets;
  const metrics = result.metrics;
  return {
    schemaVersion: 1,
    kind: "deterministic-simulation",
    id: result.id,
    status: result.status,
    evidence: {
      classification: "modeled",
      verificationStatus: result.verificationStatus,
      note: "The scripted fixture and migration settlement are illustrative; this run is not compiled from the JSON intent or verified against Meteora.",
    },
    market: { base: base.symbol, quote: quote.symbol },
    metrics: {
      capitalAccumulatedBeforeMigration: assetValue(metrics.quoteAccumulated, quote.symbol),
      baseSupplyDistributed: {
        ...assetValue(metrics.baseDistributed, base.symbol),
        percentage: percentFromBps(metrics.baseDistributedBps),
      },
      graduation: {
        price: metrics.finalMigrationPrice?.toSignificantDigits(8).toString() ?? null,
        priceUnit: `${quote.symbol}/${base.symbol}`,
        fullyDilutedValue: metrics.finalMigrationFdv?.toSignificantDigits(8).toString() ?? null,
        quoteAsset: quote.symbol,
      },
      finalSpotPrice: {
        amount: metrics.finalSpotPrice.toSignificantDigits(8).toString(),
        unit: `${quote.symbol}/${base.symbol}`,
      },
      tradingFees: {
        quote: currencyValue(metrics.feesGenerated.quote, quote.symbol),
        base: currencyValue(metrics.feesGenerated.base, base.symbol),
      },
      migrationFees: {
        partner: assetValue(metrics.migrationFees.partner, quote.symbol),
        creator: assetValue(metrics.migrationFees.creator, quote.symbol),
      },
      surplus: {
        protocol: assetValue(metrics.surplus.protocol, quote.symbol),
        partner: assetValue(metrics.surplus.partner, quote.symbol),
        creator: assetValue(metrics.surplus.creator, quote.symbol),
      },
      largestTradePriceMovementPercentage: percentFromBps(metrics.maximumPriceImpactBps),
      maximumDrawdownPercentage: percentFromBps(metrics.maximumDrawdownBps),
      migrationStatus: result.finalState.migrationProgress,
      ...(metrics.liquidityAllocation
        ? {
            postMigrationLiquidityShares: {
              creator: allocationOwnerDocument(
                metrics.liquidityAllocation.creator,
                metrics.liquidityAllocation.distributableLiquidity,
              ),
              partner: allocationOwnerDocument(
                metrics.liquidityAllocation.partner,
                metrics.liquidityAllocation.distributableLiquidity,
              ),
            },
          }
        : {}),
    },
    trades: result.trades.map((trade, index) => ({
      index: index + 1,
      direction: trade.direction,
      status: trade.status,
      requestedInput: assetValue(
        trade.requestedInput,
        trade.requestedInput.asset === "base" ? base.symbol : quote.symbol,
      ),
      consumedInput: assetValue(
        trade.consumedInput,
        trade.consumedInput.asset === "base" ? base.symbol : quote.symbol,
      ),
      unfilledInput: assetValue(
        trade.unfilledInput,
        trade.unfilledInput.asset === "base" ? base.symbol : quote.symbol,
      ),
      output: assetValue(trade.output, trade.output.asset === "base" ? base.symbol : quote.symbol),
      spotPriceAfter: trade.metrics.spotPriceAfter.toSignificantDigits(8).toString(),
      priceUnit: `${quote.symbol}/${base.symbol}`,
      priceMovementPercentage: percentFromBps(trade.metrics.priceImpactBps),
    })),
    ...(advanced
      ? {
          advanced: {
            description:
              "Exact raw protocol and simulator state values; integer amounts are atomic units and prices use Q64.64.",
            simulation: result,
          },
        }
      : {}),
  };
}

function formatTrade(
  trade: TradeResult,
  index: number,
  baseSymbol: string,
  quoteSymbol: string,
): string {
  const inputSymbol = trade.direction === "buy" ? quoteSymbol : baseSymbol;
  const outputSymbol = trade.direction === "buy" ? baseSymbol : quoteSymbol;
  return [
    `${index}. ${trade.direction === "buy" ? "Buy" : "Sell"} (${trade.status})`,
    `${formatCurrencyAmount(trade.consumedInput.amount)} ${inputSymbol} in`,
    `${formatCurrencyAmount(trade.output.amount)} ${outputSymbol} out`,
    `price ${trade.metrics.spotPriceAfter.toSignificantDigits(8).toString()} ${quoteSymbol}/${baseSymbol}`,
    `movement ${formatBps(trade.metrics.priceImpactBps)}%`,
  ].join(" | ");
}

export function formatAllocationOwner(
  name: string,
  allocation: Readonly<{ unlocked: bigint; permanentlyLocked: bigint; vesting: bigint }>,
  total: bigint,
): string {
  const ownerTotal = allocation.unlocked + allocation.permanentlyLocked + allocation.vesting;
  return `${name} ${formatRatio(ownerTotal, total)}% (unlocked ${formatRatio(allocation.unlocked, total)}%, permanently locked ${formatRatio(allocation.permanentlyLocked, total)}%, vesting ${formatRatio(allocation.vesting, total)}%)`;
}

function formatAdvancedSimulationValues(result: DeterministicSimulationResult): string[] {
  const lines = ["Advanced protocol values:"];
  const curve = result.initialState.curve;
  lines.push(
    `Migration quote threshold atomic: ${curve.migrationQuoteThresholdAtomic}`,
    `Start sqrt price Q64.64: ${curve.startSqrtPriceQ64x64}`,
  );
  for (const [index, segment] of curve.segments.entries()) {
    lines.push(
      `Segment ${index + 1}: lower sqrt price Q64.64 ${segment.lowerSqrtPriceQ64x64}; upper sqrt price Q64.64 ${segment.upperSqrtPriceQ64x64}; liquidity ${segment.liquidity}`,
    );
  }
  for (const [index, trade] of result.trades.entries()) {
    lines.push(
      `Trade ${index + 1}: requested ${trade.requestedInput.amount.raw} ${trade.requestedInput.asset} atomic; consumed ${trade.consumedInput.amount.raw}; unfilled ${trade.unfilledInput.amount.raw}; output ${trade.output.amount.raw} ${trade.output.asset} atomic; next sqrt price Q64.64 ${trade.nextSqrtPriceQ64x64}; trading fee ${trade.fees.tradingFee.amount.raw} ${trade.fees.tradingFee.asset} atomic; protocol fee ${trade.fees.protocolFee.amount.raw} ${trade.fees.protocolFee.asset} atomic; referral fee ${trade.fees.referralFee.amount.raw} ${trade.fees.referralFee.asset} atomic`,
    );
  }
  lines.push(
    `Migration settlement: DAMM base ${result.finalState.ledger.migration.dammLiquidity.base.raw} atomic; DAMM quote ${result.finalState.ledger.migration.dammLiquidity.quote.raw} atomic; protocol liquidity fee base ${result.finalState.ledger.migration.protocolLiquidityFee.base.raw} atomic; protocol liquidity fee quote ${result.finalState.ledger.migration.protocolLiquidityFee.quote.raw} atomic; leftover base ${result.finalState.ledger.leftoverBase.amount.raw} atomic`,
  );
  if (result.metrics.liquidityAllocation) {
    lines.push(
      `Distributed liquidity units: ${result.metrics.liquidityAllocation.distributableLiquidity}; creator unlocked ${result.metrics.liquidityAllocation.creator.unlocked}; creator permanently locked ${result.metrics.liquidityAllocation.creator.permanentlyLocked}; creator vesting ${result.metrics.liquidityAllocation.creator.vesting}; partner unlocked ${result.metrics.liquidityAllocation.partner.unlocked}; partner permanently locked ${result.metrics.liquidityAllocation.partner.permanentlyLocked}; partner vesting ${result.metrics.liquidityAllocation.partner.vesting}`,
    );
  }
  return lines;
}

function formatBps(value: bigint): string {
  return new Decimal(value.toString()).div(100).toFixed(2);
}

function percentFromBps(value: bigint): string {
  return new Decimal(value.toString()).div(100).toFixed(2);
}

function assetValue(
  value: Readonly<{ amount: { raw: bigint; decimals: number } }>,
  symbol: string,
) {
  return { amount: formatCurrencyAmount(value.amount), asset: symbol };
}

function currencyValue(value: Readonly<{ raw: bigint; decimals: number }>, symbol: string) {
  return { amount: formatCurrencyAmount(value), asset: symbol };
}

function allocationOwnerDocument(
  allocation: Readonly<{ unlocked: bigint; permanentlyLocked: bigint; vesting: bigint }>,
  total: bigint,
) {
  const ownerTotal = allocation.unlocked + allocation.permanentlyLocked + allocation.vesting;
  return {
    totalSharePercentage: ratioPercent(ownerTotal, total),
    unlockedPercentage: ratioPercent(allocation.unlocked, total),
    permanentlyLockedPercentage: ratioPercent(allocation.permanentlyLocked, total),
    vestingPercentage: ratioPercent(allocation.vesting, total),
  };
}

function ratioPercent(part: bigint, total: bigint): string {
  if (total === 0n) return "not applicable";
  return new Decimal(part.toString()).mul(100).div(total.toString()).toFixed(2);
}

function formatRatio(part: bigint, total: bigint): string {
  if (total === 0n) return "not applicable";
  return new Decimal(part.toString()).mul(100).div(total.toString()).toFixed(2);
}
