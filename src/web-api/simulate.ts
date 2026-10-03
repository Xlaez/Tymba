import { compileDocument } from "../cli/compile.js";
import { convertConfigBigintStrings } from "../cli/validate.js";
import { formatCurrencyAmount, parseCurrencyAmount } from "../domain/currency-amount.js";
import { MAX_CURVE_U64 } from "../domain/curve.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import type { DeterministicSimulationResult } from "../domain/simulation.js";
import type { DeterministicTradeInput } from "../domain/simulator.js";
import { getPoolEconomicSnapshot, runDeterministicSimulation } from "../domain/simulator.js";
import {
  createInitialPoolState,
  validateSolverSimulationConfiguration,
} from "../domain/solver-deterministic-verification.js";
import { percent } from "./compile.js";
import type { WebSimulationResponse, WebTradeInput } from "./contracts.js";
import { isRecord } from "./review.js";

export function simulateWebDocument(
  input: unknown,
  retainRun?: (run: DeterministicSimulationResult) => void,
): WebSimulationResponse {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !["compileRequest", "candidateId", "trades"].includes(key)) ||
    !isRecord(input.compileRequest) ||
    typeof input.candidateId !== "string" ||
    input.candidateId.length > 256
  ) {
    return failed(
      "$",
      "invalid_simulation_request",
      "Provide compileRequest, candidateId, and ordered trades.",
    );
  }
  const market = validateMarketIntent(input.compileRequest.marketIntent);
  if (market.status === "invalid") return { status: "failed", issues: market.issues };
  if (!Array.isArray(input.trades) || input.trades.length === 0 || input.trades.length > 100)
    return failed("$.trades", "invalid_trade_count", "Provide 1–100 explicit trades.");
  const parsed: DeterministicTradeInput[] = [];
  const humanTrades: WebTradeInput[] = [];
  for (const [index, value] of input.trades.entries()) {
    const path = `$.trades[${index}]`;
    if (
      !isRecord(value) ||
      Object.keys(value).some(
        (key) => !["direction", "amount", "slot", "timestampSeconds"].includes(key),
      ) ||
      (value.direction !== "buy" && value.direction !== "sell") ||
      typeof value.amount !== "string" ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.amount) ||
      value.amount.length > 256 ||
      !clockInteger(value.slot) ||
      !clockInteger(value.timestampSeconds)
    ) {
      return failed(
        path,
        "invalid_trade",
        "Use buy/sell, a positive human-unit decimal string, and non-negative u64 slot/timestamp strings.",
      );
    }
    try {
      const decimals =
        value.direction === "buy"
          ? market.normalized.quoteDecimals
          : market.normalized.baseDecimals;
      const amount = parseCurrencyAmount(value.amount, decimals);
      if (amount.raw <= 0n || amount.raw > MAX_CURVE_U64)
        throw new RangeError("Trade input must be positive and fit u64 atomic units.");
      parsed.push({
        direction: value.direction,
        inputAtomic: amount.raw,
        clock: { slot: BigInt(value.slot), timestampSeconds: BigInt(value.timestampSeconds) },
      });
      humanTrades.push({
        direction: value.direction,
        amount: value.amount,
        slot: value.slot,
        timestampSeconds: value.timestampSeconds,
      });
    } catch (error) {
      return failed(
        `${path}.amount`,
        "invalid_trade_amount",
        error instanceof Error ? error.message : "Invalid trade amount.",
      );
    }
  }
  const report = compileDocument(input.compileRequest);
  const candidate = report.draftCandidates.find(({ id }) => id === input.candidateId);
  if (!candidate)
    return failed(
      "$.candidateId",
      "unknown_candidate",
      "Candidate is not a feasible draft for this exact compile request. Recompile and select a draft.",
    );
  const settings = validateSolverSimulationConfiguration(
    convertConfigBigintStrings(input.compileRequest.simulation, "$.simulation"),
  );
  if (settings.status === "invalid")
    return failed(
      "$.compileRequest.simulation",
      "invalid_configuration",
      "Simulator configuration is invalid.",
    );
  let previousClock = settings.value.clock;
  for (const [index, trade] of parsed.entries()) {
    if (
      !trade.clock ||
      trade.clock.slot < previousClock.slot ||
      trade.clock.timestampSeconds < previousClock.timestampSeconds
    )
      return failed(
        `$.trades[${index}]`,
        "clock_moves_backwards",
        "Both slot and timestamp must be non-decreasing from the configured initial clock.",
      );
    previousClock = trade.clock;
  }
  try {
    const result = runDeterministicSimulation({
      id: `web-${candidate.id}`,
      initialState: createInitialPoolState(market.normalized, candidate.curve, settings.value),
      trades: parsed,
    });
    retainRun?.(result);
    return {
      status: result.status,
      id: result.id,
      candidateId: candidate.id,
      engineVersion: result.engineVersion,
      sdkVersion: result.sdkVersion,
      verificationStatus: "unverified",
      lifecycle: result.finalState.migrationProgress,
      randomSeed: null,
      inputTrades: humanTrades,
      trades: result.trades.map((trade) => ({
        direction: trade.direction,
        status: trade.status,
        requestedInput: formatCurrencyAmount(trade.requestedInput.amount),
        consumedInput: formatCurrencyAmount(trade.consumedInput.amount),
        unfilledInput: formatCurrencyAmount(trade.unfilledInput.amount),
        output: formatCurrencyAmount(trade.output.amount),
        spotPriceAfter: trade.metrics.spotPriceAfter.toFixed(),
        priceImpactPct: percent(trade.metrics.priceImpactBps),
        fee: formatCurrencyAmount(trade.fees.tradingFee.amount),
        feeAsset: trade.fees.tradingFee.asset,
      })),
      metrics: {
        finalSpotPrice: result.metrics.finalSpotPrice.toFixed(),
        quoteAccumulated: formatCurrencyAmount(result.metrics.quoteAccumulated.amount),
        baseDistributed: formatCurrencyAmount(result.metrics.baseDistributed.amount),
        baseDistributionPct: percent(result.metrics.baseDistributedBps),
        migrationProgressPct: percent(
          getPoolEconomicSnapshot(result.finalState).migrationProgressBps,
        ),
        maximumPriceImpactPct: percent(result.metrics.maximumPriceImpactBps),
        maximumDrawdownPct: percent(result.metrics.maximumDrawdownBps),
        baseFees: formatCurrencyAmount(result.metrics.feesGenerated.base),
        quoteFees: formatCurrencyAmount(result.metrics.feesGenerated.quote),
      },
    };
  } catch (error) {
    return failed(
      "$.trades",
      "simulation_execution_failed",
      error instanceof Error
        ? error.message
        : "The script failed. No completed metrics are available.",
    );
  }
}

function clockInteger(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 20 &&
    /^(?:0|[1-9]\d*)$/.test(value) &&
    BigInt(value) <= MAX_CURVE_U64
  );
}

function failed(path: string, code: string, message: string): WebSimulationResponse {
  return { status: "failed", issues: [{ path, code, message }] };
}
