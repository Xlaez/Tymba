import { Decimal } from "decimal.js";
import { currencyAmount } from "../currency-amount.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type {
  AttackFailure,
  AttackIterationOutcome,
  AttackResult,
  PumpAndDumpMetrics,
} from "../attack-result.js";
import { createSeededRandom, createSeededRunMetadata } from "../seeded-random.js";
import type { AssetAmountPair, PoolState } from "../pool-state.js";
import type { DistributionSummary } from "../simulation.js";
import type { SimulationAgent } from "../stochastic-simulation.js";
import { createMvpAgentPopulation } from "../simulation-scenario.js";
import type { AgentDistributionConfiguration } from "../simulation-scenario.js";
import { runStochasticSimulationTrace } from "../stochastic-simulation.js";
import { quoteRequiredForPrice } from "./price-recovery.js";
import {
  DBC_SIMULATION_ENGINE_VERSION,
  getSpotPrice,
  PINNED_SIMULATION_SDK_VERSION,
} from "../simulator.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const BASIS_POINTS = 10_000n;
const MAX_ATTACK_ITERATIONS = 10_000n;
const MAX_ATTACK_TICKS = 10_000n;
const MAX_ATTACK_AGENT_TICK_ACTIONS = 1_000_000n;

export type PumpAndDumpAttackInput = Readonly<{
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  initialState: PoolState;
  supportingAgentDistribution: AgentDistributionConfiguration;
  attacker: Readonly<{
    id: string;
    initialQuoteBalanceAtomic: bigint;
    buyQuoteAtomic: bigint;
    entryTickIndex: bigint;
    holdTicks: bigint;
    minimumMomentumBaseAtomic: bigint;
    exitShareBps: bigint;
  }>;
  ticks: Readonly<{
    tickCount: bigint;
    slotsPerTick: bigint;
    secondsPerTick: bigint;
  }>;
}>;

type PumpAndDumpIteration = Readonly<{
  attackerPnlQuoteRaw: bigint;
  peakToTroughDrawdownBps: bigint;
  lateBuyerLossBps: bigint;
  recoveryQuoteRequiredRaw: bigint;
  feesPaid: AssetAmountPair;
}>;

export function runPumpAndDumpAttack(input: PumpAndDumpAttackInput): AttackResult {
  validateInput(input);
  const seedSource = createSeededRandom(input.randomSeed);
  const outcomes: AttackIterationOutcome[] = [];
  const measurements: PumpAndDumpIteration[] = [];
  let partialIterations = 0n;
  let failedIterations = 0n;
  let completedAtSeconds = input.initialState.clock.timestampSeconds;

  for (let iterationIndex = 0n; iterationIndex < input.requestedIterations; iterationIndex += 1n) {
    const iterationId = `${input.id}-iteration-${iterationIndex}`;
    const iterationSeed = seedSource.nextUint64();
    try {
      const population = createMvpAgentPopulation(input.supportingAgentDistribution);
      const attacker = createPumpAttacker(input);
      if (population.agents.some(({ id }) => id === attacker.id)) {
        throw new TypeError(`Duplicate generated agent id: ${attacker.id}`);
      }
      const trace = runStochasticSimulationTrace({
        id: iterationId,
        randomSeed: iterationSeed,
        initialState: input.initialState,
        agents: [...population.agents, attacker],
        ticks: { ...input.ticks, executionOrder: "configured" },
      });
      if (trace.completedAtSeconds > completedAtSeconds)
        completedAtSeconds = trace.completedAtSeconds;
      const measured = measureIteration(
        trace,
        input.attacker.id,
        input.attacker.initialQuoteBalanceAtomic,
      );
      if (measured.measurement === undefined) partialIterations += 1n;
      else measurements.push(measured.measurement);
      outcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: measured.measurement === undefined ? "partial" : "completed",
        completedTicks: trace.completedTicks,
        ...(measured.failure === undefined ? {} : { failure: measured.failure }),
      });
    } catch (error) {
      failedIterations += 1n;
      outcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: "failed",
        completedTicks: 0n,
        failure: { code: "iteration_failed", message: errorMessage(error) },
      });
    }
  }

  const metadata = {
    ...createSeededRunMetadata(input.randomSeed),
    id: input.id,
    requestedIterations: input.requestedIterations,
    completedIterations: BigInt(measurements.length),
    partialIterations,
    failedIterations,
    iterationOutcomes: outcomes,
    engineVersion: DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: PINNED_SIMULATION_SDK_VERSION,
    startedAtSeconds: input.initialState.clock.timestampSeconds,
    completedAtSeconds,
    scenario: "pump-and-dump" as const,
  };

  if (measurements.length === 0) {
    return {
      ...metadata,
      status: "failed",
      failure: {
        code: "no_completed_iterations",
        message: "No pump-and-dump iteration completed; inspect the retained iteration outcomes.",
      },
    };
  }

  return {
    ...metadata,
    status: partialIterations + failedIterations === 0n ? "completed" : "partial",
    metrics: summarizeMeasurements(measurements, input.initialState),
  };
}

function createPumpAttacker(input: PumpAndDumpAttackInput): SimulationAgent {
  return {
    id: input.attacker.id,
    archetype: "whale",
    initialQuoteBalanceAtomic: input.attacker.initialQuoteBalanceAtomic,
    initialBaseBalanceAtomic: 0n,
    initialBaseCostBasisQuoteAtomic: 0n,
    decide: (observation) => {
      const portfolio = observation.portfolio;
      if (
        portfolio.successfulBuyCount === 0n &&
        observation.tickIndex === input.attacker.entryTickIndex
      ) {
        return portfolio.quoteBalanceAtomic >= input.attacker.buyQuoteAtomic
          ? { kind: "buy", inputAtomic: input.attacker.buyQuoteAtomic }
          : { kind: "wait" };
      }
      if (
        portfolio.baseBalanceAtomic > 0n &&
        portfolio.successfulSellCount === 0n &&
        portfolio.firstBuyTickIndex !== undefined &&
        observation.tickIndex - portfolio.firstBuyTickIndex >= input.attacker.holdTicks &&
        observation.cumulativeBaseBoughtAtomicByArchetype["momentum-trader"] >=
          input.attacker.minimumMomentumBaseAtomic
      ) {
        const amount = (portfolio.baseBalanceAtomic * input.attacker.exitShareBps) / BASIS_POINTS;
        return { kind: "sell", inputAtomic: amount > 0n ? amount : 1n };
      }
      return { kind: "wait" };
    },
  };
}

function validateInput(input: PumpAndDumpAttackInput): void {
  if (input.id.trim().length === 0) throw new TypeError("Attack run id must be non-empty");
  if (input.attacker.id.trim().length === 0) throw new TypeError("Attacker id must be non-empty");
  createSeededRunMetadata(input.randomSeed);
  if (
    typeof input.requestedIterations !== "bigint" ||
    input.requestedIterations <= 0n ||
    input.requestedIterations > MAX_ATTACK_ITERATIONS
  ) {
    throw new RangeError(`Requested iterations must be between 1 and ${MAX_ATTACK_ITERATIONS}`);
  }
  if (
    input.initialState.migrationProgress !== "bonding" ||
    input.supportingAgentDistribution.counts["momentum-trader"] <= 0n ||
    input.supportingAgentDistribution.counts.whale !== 0n
  ) {
    throw new RangeError(
      "Pump-and-dump requires a bonding pool, momentum traders, and no supporting whale agents",
    );
  }
  createMvpAgentPopulation(input.supportingAgentDistribution);
  validatePositiveU64(input.attacker.buyQuoteAtomic, "Attacker buy size");
  validatePositiveU64(input.attacker.initialQuoteBalanceAtomic, "Attacker quote balance");
  if (input.attacker.buyQuoteAtomic > input.attacker.initialQuoteBalanceAtomic) {
    throw new RangeError("Attacker buy size exceeds the attacker's quote balance");
  }
  validatePositiveU64(input.attacker.minimumMomentumBaseAtomic, "Minimum momentum base demand");
  if (
    typeof input.attacker.holdTicks !== "bigint" ||
    input.attacker.holdTicks < 0n ||
    typeof input.attacker.entryTickIndex !== "bigint" ||
    input.attacker.entryTickIndex < 0n
  ) {
    throw new RangeError("Attacker entry tick and hold ticks must be non-negative bigints");
  }
  if (
    typeof input.attacker.exitShareBps !== "bigint" ||
    input.attacker.exitShareBps <= 0n ||
    input.attacker.exitShareBps > BASIS_POINTS
  ) {
    throw new RangeError("Attacker exit share must be between 1 and 10000 basis points");
  }
  if (
    typeof input.ticks.tickCount !== "bigint" ||
    input.ticks.tickCount <= 0n ||
    input.ticks.tickCount > MAX_ATTACK_TICKS ||
    input.attacker.entryTickIndex >= input.ticks.tickCount
  ) {
    throw new RangeError(
      `Tick count must include the entry tick and not exceed ${MAX_ATTACK_TICKS}`,
    );
  }
  for (const [label, value] of [
    ["Slots per tick", input.ticks.slotsPerTick],
    ["Seconds per tick", input.ticks.secondsPerTick],
  ] as const) {
    if (typeof value !== "bigint" || value <= 0n || value > MAX_CURVE_U64) {
      throw new RangeError(`${label} must be a positive unsigned 64-bit bigint`);
    }
  }
  const populationSize = Object.values(input.supportingAgentDistribution.counts).reduce(
    (total, count) => total + count,
    1n,
  );
  if (
    populationSize * input.ticks.tickCount * input.requestedIterations >
    MAX_ATTACK_AGENT_TICK_ACTIONS
  ) {
    throw new RangeError(
      `Pump-and-dump run exceeds the ${MAX_ATTACK_AGENT_TICK_ACTIONS} agent-tick action budget`,
    );
  }
}

function measureIteration(
  trace: ReturnType<typeof runStochasticSimulationTrace>,
  attackerId: string,
  initialQuoteBalanceAtomic: bigint,
): Readonly<{ measurement?: PumpAndDumpIteration; failure?: AttackFailure }> {
  const trades = trace.events.flatMap((event, index) =>
    event.kind === "trade-executed" ? [{ event, index }] : [],
  );
  const entry = trades.find(
    ({ event }) => event.agentId === attackerId && event.result.direction === "buy",
  );
  const exit = trades.find(
    ({ event }) => event.agentId === attackerId && event.result.direction === "sell",
  );
  if (!entry || !exit) {
    return {
      failure: {
        code: "pump_or_dump_not_observed",
        message: "The attacker did not both buy and exit within the configured ticks.",
      },
    };
  }
  if (trace.status === "partial") {
    const firstFailure = trace.events.find((event) => event.kind === "agent-failed");
    return {
      failure: {
        code: "simulation_partial",
        message:
          firstFailure?.kind === "agent-failed" ? firstFailure.message : "Simulation was partial.",
      },
    };
  }
  const momentumBuys = trades.filter(
    ({ event, index }) =>
      event.archetype === "momentum-trader" &&
      event.result.direction === "buy" &&
      index > entry.index &&
      index < exit.index,
  );
  const momentumBaseRaw = momentumBuys.reduce(
    (total, { event }) => total + event.result.output.amount.raw,
    0n,
  );
  const momentumQuoteRaw = momentumBuys.reduce(
    (total, { event }) => total + event.result.consumedInput.amount.raw,
    0n,
  );
  if (momentumBaseRaw === 0n) {
    return {
      failure: {
        code: "momentum_demand_not_observed",
        message: "No momentum-trader purchase occurred between attacker entry and exit.",
      },
    };
  }

  let peakPrice = getSpotPrice(trace.initialState);
  let troughPrice = peakPrice;
  let maximumDrawdownBps = 0n;
  for (const { event } of trades) {
    const price = event.result.metrics.spotPriceAfter;
    if (price.greaterThan(peakPrice)) peakPrice = price;
    if (peakPrice.greaterThan(price)) {
      const drawdown = new ExactDecimal(peakPrice.minus(price).toString())
        .mul(BASIS_POINTS.toString())
        .div(peakPrice)
        .floor();
      if (drawdown.greaterThan(maximumDrawdownBps)) {
        maximumDrawdownBps = BigInt(drawdown.toFixed(0));
      }
    }
    if (event.agentId === attackerId && event.result.direction === "sell") troughPrice = price;
  }
  for (const { event, index } of trades) {
    if (index <= exit.index) continue;
    if (event.result.metrics.spotPriceAfter.lessThan(troughPrice)) {
      troughPrice = event.result.metrics.spotPriceAfter;
    }
  }
  const momentumAveragePrice = executionPriceFromAmounts(
    momentumQuoteRaw,
    momentumBaseRaw,
    trace.initialState,
  );
  const lossBps = new ExactDecimal(momentumAveragePrice.toString())
    .minus(troughPrice)
    .mul(BASIS_POINTS.toString())
    .div(momentumAveragePrice)
    .floor();
  const lateBuyerLossBps = lossBps.greaterThan(0) ? BigInt(lossBps.toFixed(0)) : 0n;
  const attackerPortfolio = trace.portfolios.find(({ agentId }) => agentId === attackerId);
  if (!attackerPortfolio) throw new RangeError("Pump-and-dump attacker portfolio is missing");
  const markedBaseQuote = new ExactDecimal(getSpotPrice(trace.finalState).toString())
    .mul(attackerPortfolio.baseBalanceAtomic.toString())
    .mul(new ExactDecimal(10).pow(trace.finalState.curve.quoteDecimals))
    .div(new ExactDecimal(10).pow(trace.finalState.curve.baseDecimals))
    .floor();
  const attackerPnlQuoteRaw =
    attackerPortfolio.quoteBalanceAtomic +
    BigInt(markedBaseQuote.toFixed(0)) -
    initialQuoteBalanceAtomic;
  const recoveryQuoteRequiredRaw = quoteRequiredForPrice(trace.finalState, peakPrice);
  if (recoveryQuoteRequiredRaw === undefined) {
    return {
      failure: {
        code: "recovery_price_unreachable",
        message: "The final bonding-curve state cannot recover to the modeled peak price.",
      },
    };
  }

  const feesPaid = trades
    .filter(({ event }) => event.agentId === attackerId)
    .reduce(
      (total, { event }) => {
        const fee = event.result.fees.tradingFee;
        if (fee.asset === "base") total.base += fee.amount.raw;
        else total.quote += fee.amount.raw;
        return total;
      },
      { base: 0n, quote: 0n },
    );

  return {
    measurement: {
      attackerPnlQuoteRaw,
      peakToTroughDrawdownBps: maximumDrawdownBps,
      lateBuyerLossBps,
      recoveryQuoteRequiredRaw,
      feesPaid: {
        base: currencyAmount(feesPaid.base, trace.initialState.curve.baseDecimals),
        quote: currencyAmount(feesPaid.quote, trace.initialState.curve.quoteDecimals),
      },
    },
  };
}

function executionPriceFromAmounts(quoteRaw: bigint, baseRaw: bigint, state: PoolState): Decimal {
  return new ExactDecimal(quoteRaw.toString())
    .mul(new ExactDecimal(10).pow(state.curve.baseDecimals))
    .div(
      new ExactDecimal(baseRaw.toString()).mul(new ExactDecimal(10).pow(state.curve.quoteDecimals)),
    );
}

function summarizeMeasurements(
  measurements: readonly PumpAndDumpIteration[],
  state: PoolState,
): PumpAndDumpMetrics {
  const pnl = summarizeBigints(measurements.map(({ attackerPnlQuoteRaw }) => attackerPnlQuoteRaw));
  const recovery = summarizeBigints(
    measurements.map(({ recoveryQuoteRequiredRaw }) => recoveryQuoteRequiredRaw),
  );
  return {
    attackerPnlQuote: summarizeAssetAmounts(pnl, state.curve.quoteDecimals, "quote"),
    peakToTroughDrawdownBps: summarizeBigints(
      measurements.map(({ peakToTroughDrawdownBps }) => peakToTroughDrawdownBps),
    ),
    lateBuyerLossBps: summarizeBigints(
      measurements.map(({ lateBuyerLossBps }) => lateBuyerLossBps),
    ),
    recoveryQuoteRequired: summarizeAssetAmounts(recovery, state.curve.quoteDecimals, "quote"),
    feesPaid: summarizeFees(measurements.map(({ feesPaid }) => feesPaid)),
  };
}

function summarizeAssetAmounts(
  summary: DistributionSummary<bigint>,
  decimals: number,
  asset: "quote",
): PumpAndDumpMetrics["attackerPnlQuote"] {
  const tagged = (raw: bigint) => ({ asset, amount: currencyAmount(raw, decimals) });
  return { p05: tagged(summary.p05), median: tagged(summary.median), p95: tagged(summary.p95) };
}

function summarizeFees(values: readonly AssetAmountPair[]): DistributionSummary<AssetAmountPair> {
  const first = values.at(0);
  if (first === undefined) throw new RangeError("Cannot summarize an empty attack sample");
  const base = summarizeBigints(values.map(({ base }) => base.raw));
  const quote = summarizeBigints(values.map(({ quote }) => quote.raw));
  return {
    p05: {
      base: currencyAmount(base.p05, first.base.decimals),
      quote: currencyAmount(quote.p05, first.quote.decimals),
    },
    median: {
      base: currencyAmount(base.median, first.base.decimals),
      quote: currencyAmount(quote.median, first.quote.decimals),
    },
    p95: {
      base: currencyAmount(base.p95, first.base.decimals),
      quote: currencyAmount(quote.p95, first.quote.decimals),
    },
  };
}

function summarizeBigints(values: readonly bigint[]): DistributionSummary<bigint> {
  if (values.length === 0) throw new RangeError("Cannot summarize an empty attack sample");
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    p05: rankedValue(sorted, nearestRankIndex(sorted.length, 500n)),
    median: rankedValue(sorted, nearestRankIndex(sorted.length, 5_000n)),
    p95: rankedValue(sorted, nearestRankIndex(sorted.length, 9_500n)),
  };
}

function nearestRankIndex(sampleSize: number, percentileBps: bigint): number {
  const count = BigInt(sampleSize);
  const rank = (count * percentileBps + BASIS_POINTS - 1n) / BASIS_POINTS;
  return Number(rank > 0n ? rank - 1n : 0n);
}

function rankedValue<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) throw new RangeError("Attack percentile rank is outside the sample");
  return value;
}

function validatePositiveU64(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_CURVE_U64) {
    throw new RangeError(`${label} must be a positive unsigned 64-bit bigint`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
