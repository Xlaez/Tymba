import { Decimal } from "decimal.js";
import { currencyAmount } from "../currency-amount.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type {
  AttackFailure,
  AttackIterationOutcome,
  AttackResult,
  OpeningSniperMetrics,
} from "../attack-result.js";
import { createSeededRandom, createSeededRunMetadata } from "../seeded-random.js";
import type { AssetAmountPair, PoolState } from "../pool-state.js";
import type { DistributionSummary } from "../simulation.js";
import { createMvpAgent } from "../simulation-agents.js";
import type { AgentDistributionConfiguration } from "../simulation-scenario.js";
import { createMvpAgentPopulation } from "../simulation-scenario.js";
import { runStochasticSimulationTrace } from "../stochastic-simulation.js";
import {
  DBC_SIMULATION_ENGINE_VERSION,
  getSpotPrice,
  PINNED_SIMULATION_SDK_VERSION,
} from "../simulator.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const PERCENTILE_DENOMINATOR = 10_000n;
const MAX_ATTACK_ITERATIONS = 10_000n;
const MAX_ATTACK_TICKS = 10_000n;
const MAX_ATTACK_AGENT_TICK_ACTIONS = 1_000_000n;

export type OpeningSniperAttackInput = Readonly<{
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  initialState: PoolState;
  supportingAgentDistribution: AgentDistributionConfiguration;
  attacker: Readonly<{
    id: string;
    initialQuoteBalanceAtomic: bigint;
    buyQuoteAtomic: bigint;
    holdTicks: bigint;
    minimumOtherBuyerBaseAtomic: bigint;
    exitShareBps: bigint;
  }>;
  ticks: Readonly<{
    tickCount: bigint;
    slotsPerTick: bigint;
    secondsPerTick: bigint;
  }>;
}>;

type OpeningSniperIteration = Readonly<{
  attackerPnlQuoteRaw: bigint;
  lateBuyerPriceDisadvantageBps: bigint;
  drawdownAfterExitBps: bigint;
  feesPaid: AssetAmountPair;
}>;

export function runOpeningSniperAttack(input: OpeningSniperAttackInput): AttackResult {
  validateInput(input);
  const seedSource = createSeededRandom(input.randomSeed);
  const outcomes: AttackIterationOutcome[] = [];
  const measurements: OpeningSniperIteration[] = [];
  let partialIterations = 0n;
  let failedIterations = 0n;
  let completedAtSeconds = input.initialState.clock.timestampSeconds;

  for (let iterationIndex = 0n; iterationIndex < input.requestedIterations; iterationIndex += 1n) {
    const iterationId = `${input.id}-iteration-${iterationIndex}`;
    const iterationSeed = seedSource.nextUint64();
    try {
      const population = createMvpAgentPopulation(input.supportingAgentDistribution);
      const attacker = createMvpAgent({
        id: input.attacker.id,
        archetype: "sniper",
        initialQuoteBalanceAtomic: input.attacker.initialQuoteBalanceAtomic,
        initialBaseBalanceAtomic: 0n,
        initialBaseCostBasisQuoteAtomic: 0n,
        buyQuoteAtomic: input.attacker.buyQuoteAtomic,
        holdTicks: input.attacker.holdTicks,
        minimumOtherBuyerBaseAtomic: input.attacker.minimumOtherBuyerBaseAtomic,
        exitShareBps: input.attacker.exitShareBps,
      });
      if (population.agents.some(({ id }) => id === attacker.id)) {
        throw new TypeError(`Duplicate generated agent id: ${attacker.id}`);
      }
      const trace = runStochasticSimulationTrace({
        id: iterationId,
        randomSeed: iterationSeed,
        initialState: input.initialState,
        agents: [attacker, ...population.agents],
        ticks: { ...input.ticks, executionOrder: "configured" },
      });
      if (trace.completedAtSeconds > completedAtSeconds)
        completedAtSeconds = trace.completedAtSeconds;

      const measured = measureCompletedIteration(
        trace,
        input.attacker.id,
        input.attacker.initialQuoteBalanceAtomic,
        input.initialState,
      );
      const failure = measured.failure;
      if (measured.measurement === undefined) partialIterations += 1n;
      else measurements.push(measured.measurement);
      outcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: measured.measurement === undefined ? "partial" : "completed",
        completedTicks: trace.completedTicks,
        ...(failure === undefined ? {} : { failure }),
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
    scenario: "opening-sniper" as const,
  };

  if (measurements.length === 0) {
    return {
      ...metadata,
      status: "failed",
      failure: {
        code: "no_completed_iterations",
        message: "No opening-sniper iteration completed; inspect the retained iteration outcomes.",
      },
    };
  }

  return {
    ...metadata,
    status: partialIterations + failedIterations === 0n ? "completed" : "partial",
    metrics: summarizeMeasurements(measurements, input.initialState),
  };
}

function validateInput(input: OpeningSniperAttackInput): void {
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
    input.supportingAgentDistribution.counts["retail-buyer"] <= 0n ||
    input.supportingAgentDistribution.counts.sniper !== 0n
  ) {
    throw new RangeError(
      "Opening sniper requires a bonding pool, retail buyers, and no supporting snipers",
    );
  }
  createMvpAgentPopulation(input.supportingAgentDistribution);
  validatePositiveU64(input.attacker.initialQuoteBalanceAtomic, "Attacker quote balance");
  validatePositiveU64(input.attacker.buyQuoteAtomic, "Sniper quote size");
  if (input.attacker.buyQuoteAtomic > input.attacker.initialQuoteBalanceAtomic) {
    throw new RangeError("Sniper quote size exceeds the attacker's quote balance");
  }
  validatePositiveU64(input.attacker.minimumOtherBuyerBaseAtomic, "Minimum retail base demand");
  if (typeof input.attacker.holdTicks !== "bigint" || input.attacker.holdTicks < 0n) {
    throw new RangeError("Sniper hold ticks must be a non-negative bigint");
  }
  if (
    typeof input.attacker.exitShareBps !== "bigint" ||
    input.attacker.exitShareBps <= 0n ||
    input.attacker.exitShareBps > PERCENTILE_DENOMINATOR
  ) {
    throw new RangeError("Sniper exit share must be between 1 and 10000 basis points");
  }
  if (
    typeof input.ticks.tickCount !== "bigint" ||
    input.ticks.tickCount <= 0n ||
    input.ticks.tickCount > MAX_ATTACK_TICKS
  ) {
    throw new RangeError(`Tick count must be between 1 and ${MAX_ATTACK_TICKS}`);
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
      `Opening-sniper run exceeds the ${MAX_ATTACK_AGENT_TICK_ACTIONS} agent-tick action budget`,
    );
  }
}

function measureCompletedIteration(
  trace: ReturnType<typeof runStochasticSimulationTrace>,
  attackerId: string,
  initialQuoteBalanceAtomic: bigint,
  initialState: PoolState,
): Readonly<{ measurement?: OpeningSniperIteration; failure?: AttackFailure }> {
  const tradeEvents = trace.events.flatMap((event, index) =>
    event.kind === "trade-executed" ? [{ event, index }] : [],
  );
  const entry = tradeEvents.find(
    ({ event }) => event.agentId === attackerId && event.result.direction === "buy",
  );
  const exit = tradeEvents.find(
    ({ event }) => event.agentId === attackerId && event.result.direction === "sell",
  );
  if (!entry || !exit) {
    return {
      failure: {
        code: "entry_or_exit_not_observed",
        message: "The attacker did not both enter and exit within the configured ticks.",
      },
    };
  }
  const retailBuys = tradeEvents.filter(
    ({ event, index }) =>
      event.archetype === "retail-buyer" && event.result.direction === "buy" && index > entry.index,
  );
  const retailBaseRaw = retailBuys.reduce(
    (total, { event }) => total + event.result.output.amount.raw,
    0n,
  );
  if (retailBaseRaw === 0n) {
    return {
      failure: {
        code: "retail_demand_not_observed",
        message: "No retail buy occurred after the sniper entered.",
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

  const attackerPortfolio = trace.portfolios.find(({ agentId }) => agentId === attackerId);
  if (!attackerPortfolio)
    throw new RangeError("Sniper portfolio is missing from the simulation trace");
  const finalPrice = getSpotPrice(trace.finalState);
  const remainingBaseValueQuoteRaw = new ExactDecimal(finalPrice.toString())
    .mul(attackerPortfolio.baseBalanceAtomic.toString())
    .mul(new ExactDecimal(10).pow(trace.finalState.curve.quoteDecimals))
    .div(new ExactDecimal(10).pow(trace.finalState.curve.baseDecimals))
    .floor();
  const attackerPnlQuoteRaw =
    attackerPortfolio.quoteBalanceAtomic +
    BigInt(remainingBaseValueQuoteRaw.toFixed(0)) -
    initialQuoteBalanceAtomic;

  const sniperEntryPrice = entry.event.result.metrics.spotPriceAfter;
  const retailQuoteRaw = retailBuys.reduce(
    (total, { event }) => total + event.result.consumedInput.amount.raw,
    0n,
  );
  const retailAveragePrice = executionPriceFromAmounts(retailQuoteRaw, retailBaseRaw, initialState);
  const disadvantage = new ExactDecimal(retailAveragePrice.toString())
    .minus(sniperEntryPrice)
    .mul(PERCENTILE_DENOMINATOR.toString())
    .div(sniperEntryPrice)
    .floor();
  const lateBuyerPriceDisadvantageBps = disadvantage.greaterThan(0)
    ? BigInt(disadvantage.toFixed(0))
    : 0n;

  let peakPrice = exit.event.result.metrics.spotPriceAfter;
  let drawdownAfterExitBps = 0n;
  for (const { event, index } of tradeEvents) {
    if (index <= exit.index) continue;
    const price = event.result.metrics.spotPriceAfter;
    if (price.greaterThan(peakPrice)) peakPrice = price;
    if (peakPrice.greaterThan(price)) {
      const drawdown = new ExactDecimal(peakPrice.minus(price).toString())
        .mul(PERCENTILE_DENOMINATOR.toString())
        .div(peakPrice)
        .floor();
      if (drawdown.greaterThan(drawdownAfterExitBps)) {
        drawdownAfterExitBps = BigInt(drawdown.toFixed(0));
      }
    }
  }

  const feesPaid = tradeEvents
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
      lateBuyerPriceDisadvantageBps,
      drawdownAfterExitBps,
      feesPaid: {
        base: currencyAmount(feesPaid.base, initialState.curve.baseDecimals),
        quote: currencyAmount(feesPaid.quote, initialState.curve.quoteDecimals),
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
  measurements: readonly OpeningSniperIteration[],
  state: PoolState,
): OpeningSniperMetrics {
  const pnlSummary = summarizeBigints(
    measurements.map(({ attackerPnlQuoteRaw }) => attackerPnlQuoteRaw),
  );
  return {
    attackerPnlQuote: {
      p05: { asset: "quote", amount: currencyAmount(pnlSummary.p05, state.curve.quoteDecimals) },
      median: {
        asset: "quote",
        amount: currencyAmount(pnlSummary.median, state.curve.quoteDecimals),
      },
      p95: { asset: "quote", amount: currencyAmount(pnlSummary.p95, state.curve.quoteDecimals) },
    },
    lateBuyerPriceDisadvantageBps: summarizeBigints(
      measurements.map(({ lateBuyerPriceDisadvantageBps }) => lateBuyerPriceDisadvantageBps),
    ),
    drawdownAfterExitBps: summarizeBigints(
      measurements.map(({ drawdownAfterExitBps }) => drawdownAfterExitBps),
    ),
    feesPaid: summarizeFees(measurements.map(({ feesPaid }) => feesPaid)),
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

function summarizeFees(values: readonly AssetAmountPair[]): DistributionSummary<AssetAmountPair> {
  const first = values.at(0);
  if (first === undefined) throw new RangeError("Cannot summarize an empty attack sample");
  const base = summarizeBigints(values.map(({ base: amount }) => amount.raw));
  const quote = summarizeBigints(values.map(({ quote: amount }) => amount.raw));
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

function rankedValue<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) throw new RangeError("Attack percentile rank is outside the sample");
  return value;
}

function nearestRankIndex(sampleSize: number, percentileBps: bigint): number {
  const count = BigInt(sampleSize);
  const rank = (count * percentileBps + PERCENTILE_DENOMINATOR - 1n) / PERCENTILE_DENOMINATOR;
  return Number(rank > 0n ? rank - 1n : 0n);
}

function validatePositiveU64(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value <= 0n || value > MAX_CURVE_U64) {
    throw new RangeError(`${label} must be a positive unsigned 64-bit bigint`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
