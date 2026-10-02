import { Decimal } from "decimal.js";
import { currencyAmount } from "../currency-amount.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type {
  AttackFailure,
  AttackIterationOutcome,
  AttackResult,
  SellCascadeMetrics,
} from "../attack-result.js";
import { createSeededRandom, createSeededRunMetadata } from "../seeded-random.js";
import type { AgentArchetype, DistributionSummary } from "../simulation.js";
import type { PoolState } from "../pool-state.js";
import { createMvpAgentPopulation } from "../simulation-scenario.js";
import type { AgentDistributionConfiguration } from "../simulation-scenario.js";
import { runStochasticSimulationTrace } from "../stochastic-simulation.js";
import {
  DBC_SIMULATION_ENGINE_VERSION,
  executeBuy,
  executeSell,
  getSpotPrice,
  PINNED_SIMULATION_SDK_VERSION,
} from "../simulator.js";
import { quoteRequiredForPrice } from "./price-recovery.js";

const BASIS_POINTS = 10_000n;
const MAX_ATTACK_ITERATIONS = 10_000n;
const MAX_ATTACK_TICKS = 10_000n;
const MAX_ATTACK_AGENT_TICK_ACTIONS = 1_000_000n;
const CASCADE_ARCHETYPES: readonly AgentArchetype[] = ["profit-taker", "panic-seller"];
const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });

export type SellCascadeAttackInput = Readonly<{
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  initialState: PoolState;
  cascadeAgentDistribution: AgentDistributionConfiguration;
  backgroundAgentDistribution: AgentDistributionConfiguration;
  ticks: Readonly<{
    tickCount: bigint;
    slotsPerTick: bigint;
    secondsPerTick: bigint;
  }>;
}>;

type SellCascadeIteration = Readonly<{
  maximumDrawdownBps: bigint;
  quoteOutflowRaw: bigint;
  recoveryQuoteRequiredRaw: bigint;
  migrationDelaySeconds: bigint;
}>;

export function runSellCascadeAttack(input: SellCascadeAttackInput): AttackResult {
  validateInput(input);
  const seedSource = createSeededRandom(input.randomSeed);
  const outcomes: AttackIterationOutcome[] = [];
  const measurements: SellCascadeIteration[] = [];
  let partialIterations = 0n;
  let failedIterations = 0n;
  let completedAtSeconds = input.initialState.clock.timestampSeconds;

  for (let iterationIndex = 0n; iterationIndex < input.requestedIterations; iterationIndex += 1n) {
    const iterationId = `${input.id}-iteration-${iterationIndex}`;
    const iterationSeed = seedSource.nextUint64();
    try {
      const cascadeAgents = createMvpAgentPopulation(input.cascadeAgentDistribution).agents;
      const backgroundAgents = createMvpAgentPopulation(input.backgroundAgentDistribution).agents;
      const backgroundIds = new Set(backgroundAgents.map(({ id }) => id));
      if (cascadeAgents.some(({ id }) => backgroundIds.has(id))) {
        throw new TypeError("Cascade and background agent identifiers must be unique");
      }
      const [attackTrace, baselineTrace] = [
        runStochasticSimulationTrace({
          id: `${iterationId}-cascade`,
          randomSeed: iterationSeed,
          initialState: input.initialState,
          agents: [...cascadeAgents, ...backgroundAgents],
          ticks: { ...input.ticks, executionOrder: "configured" },
        }),
        runStochasticSimulationTrace({
          id: `${iterationId}-baseline`,
          randomSeed: iterationSeed,
          initialState: input.initialState,
          agents: backgroundAgents,
          ticks: { ...input.ticks, executionOrder: "configured" },
        }),
      ];
      if (attackTrace.completedAtSeconds > completedAtSeconds) {
        completedAtSeconds = attackTrace.completedAtSeconds;
      }
      if (baselineTrace.completedAtSeconds > completedAtSeconds) {
        completedAtSeconds = baselineTrace.completedAtSeconds;
      }
      const measured = measureIteration(
        attackTrace,
        baselineTrace,
        new Set(cascadeAgents.map(({ id }) => id)),
        input,
      );
      if (measured.measurement === undefined) partialIterations += 1n;
      else measurements.push(measured.measurement);
      outcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: measured.measurement === undefined ? "partial" : "completed",
        completedTicks: attackTrace.completedTicks,
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
    scenario: "sell-cascade" as const,
  };

  if (measurements.length === 0) {
    return {
      ...metadata,
      status: "failed",
      failure: {
        code: "no_completed_iterations",
        message: "No sell-cascade iteration completed; inspect the retained iteration outcomes.",
      },
    };
  }

  return {
    ...metadata,
    status: partialIterations + failedIterations === 0n ? "completed" : "partial",
    metrics: summarizeMeasurements(measurements, input.initialState.curve.quoteDecimals),
  };
}

function validateInput(input: SellCascadeAttackInput): void {
  if (input.id.trim().length === 0) throw new TypeError("Attack run id must be non-empty");
  createSeededRunMetadata(input.randomSeed);
  if (
    typeof input.requestedIterations !== "bigint" ||
    input.requestedIterations <= 0n ||
    input.requestedIterations > MAX_ATTACK_ITERATIONS
  ) {
    throw new RangeError(`Requested iterations must be between 1 and ${MAX_ATTACK_ITERATIONS}`);
  }
  if (input.initialState.migrationProgress !== "bonding") {
    throw new RangeError("Sell-cascade requires an initial bonding pool");
  }
  const cascadeCounts = input.cascadeAgentDistribution.counts;
  const cascadeCount = CASCADE_ARCHETYPES.reduce(
    (total, archetype) => total + cascadeCounts[archetype],
    0n,
  );
  const unsupportedCascadeCount = Object.entries(cascadeCounts).reduce(
    (total, [archetype, count]) =>
      CASCADE_ARCHETYPES.includes(archetype as AgentArchetype) ? total : total + count,
    0n,
  );
  if (cascadeCount < 2n || unsupportedCascadeCount !== 0n) {
    throw new RangeError(
      "Sell-cascade requires at least two profit-taker or panic-seller agents only",
    );
  }
  if (
    input.backgroundAgentDistribution.counts["profit-taker"] !== 0n ||
    input.backgroundAgentDistribution.counts["panic-seller"] !== 0n
  ) {
    throw new RangeError("Background distribution cannot contain cascade archetypes");
  }
  createMvpAgentPopulation(input.cascadeAgentDistribution);
  createMvpAgentPopulation(input.backgroundAgentDistribution);
  const templates = [
    ...Object.values(input.cascadeAgentDistribution.templates),
    ...Object.values(input.backgroundAgentDistribution.templates),
  ];
  for (const configuration of templates) {
    if (
      configuration &&
      "entryTickIndex" in configuration &&
      configuration.entryTickIndex >= input.ticks.tickCount
    ) {
      throw new RangeError(
        `Agent template ${configuration.id} entry tick is outside the configured tick range`,
      );
    }
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
  const actionBudget =
    (cascadeCount +
      2n *
        Object.values(input.backgroundAgentDistribution.counts).reduce(
          (total, count) => total + count,
          0n,
        )) *
    input.ticks.tickCount *
    input.requestedIterations;
  if (actionBudget > MAX_ATTACK_AGENT_TICK_ACTIONS) {
    throw new RangeError(
      `Sell-cascade run exceeds the ${MAX_ATTACK_AGENT_TICK_ACTIONS} agent-tick action budget`,
    );
  }
}

function measureIteration(
  attackTrace: ReturnType<typeof runStochasticSimulationTrace>,
  baselineTrace: ReturnType<typeof runStochasticSimulationTrace>,
  cascadeAgentIds: ReadonlySet<string>,
  input: SellCascadeAttackInput,
): Readonly<{ measurement?: SellCascadeIteration; failure?: AttackFailure }> {
  if (attackTrace.status === "partial" || baselineTrace.status === "partial") {
    return {
      failure: {
        code: "simulation_partial",
        message: "Attack or matched baseline simulation contains an agent failure.",
      },
    };
  }
  const cascadeSells = attackTrace.events.flatMap((event, index) =>
    event.kind === "trade-executed" &&
    cascadeAgentIds.has(event.agentId) &&
    event.result.direction === "sell"
      ? [{ event, index }]
      : [],
  );
  const distinctSellerIds = new Set(cascadeSells.map(({ event }) => event.agentId));
  if (distinctSellerIds.size < 2) {
    return {
      failure: {
        code: "cascade_not_observed",
        message:
          "Fewer than two distinct cascade agents executed a sell within the configured ticks.",
      },
    };
  }
  if (
    attackTrace.finalState.migrationProgress === "bonding" ||
    baselineTrace.finalState.migrationProgress === "bonding"
  ) {
    return {
      failure: {
        code: "migration_not_observed",
        message:
          "Attack and matched baseline must both reach the DBC migration threshold to measure delay.",
      },
    };
  }

  const firstCascadeSellIndex = cascadeSells[0]?.index;
  const lastCascadeSellIndex = cascadeSells.at(-1)?.index;
  if (firstCascadeSellIndex === undefined || lastCascadeSellIndex === undefined) {
    throw new RangeError("Cascade sell indices are missing");
  }
  let peakPrice = getSpotPrice(attackTrace.initialState);
  for (const event of attackTrace.events.slice(0, firstCascadeSellIndex)) {
    if (
      event.kind === "trade-executed" &&
      event.result.metrics.spotPriceAfter.greaterThan(peakPrice)
    ) {
      peakPrice = event.result.metrics.spotPriceAfter;
    }
  }
  let maximumDrawdownBps = 0n;
  let runningPeakPrice = getSpotPrice(attackTrace.initialState);
  for (const event of attackTrace.events) {
    if (event.kind !== "trade-executed") continue;
    const price = event.result.metrics.spotPriceAfter;
    if (price.greaterThan(runningPeakPrice)) runningPeakPrice = price;
    if (runningPeakPrice.greaterThan(price)) {
      const drawdown = new ExactDecimal(runningPeakPrice.minus(price).toString())
        .mul(BASIS_POINTS.toString())
        .div(runningPeakPrice)
        .floor();
      if (drawdown.greaterThan(maximumDrawdownBps)) {
        maximumDrawdownBps = BigInt(drawdown.toFixed(0));
      }
    }
  }
  const quoteOutflowRaw = cascadeSells.reduce(
    (total, { event }) => total + event.result.output.amount.raw,
    0n,
  );
  const cascadeState = replayStateThroughEvent(attackTrace, lastCascadeSellIndex, input);
  const recoveryQuoteRequiredRaw = quoteRequiredForPrice(cascadeState, peakPrice);
  if (recoveryQuoteRequiredRaw === undefined) {
    return {
      failure: {
        code: "recovery_price_unreachable",
        message: "The cascade-state bonding curve cannot recover to the pre-cascade peak price.",
      },
    };
  }
  const baselineElapsedSeconds =
    baselineTrace.finalState.clock.timestampSeconds - input.initialState.clock.timestampSeconds;
  const attackElapsedSeconds =
    attackTrace.finalState.clock.timestampSeconds - input.initialState.clock.timestampSeconds;

  return {
    measurement: {
      maximumDrawdownBps,
      quoteOutflowRaw,
      recoveryQuoteRequiredRaw,
      migrationDelaySeconds: attackElapsedSeconds - baselineElapsedSeconds,
    },
  };
}

function replayStateThroughEvent(
  trace: ReturnType<typeof runStochasticSimulationTrace>,
  finalEventIndex: number,
  input: SellCascadeAttackInput,
): PoolState {
  let state = trace.initialState;
  for (const event of trace.events.slice(0, finalEventIndex + 1)) {
    if (event.kind !== "trade-executed") continue;
    state = {
      ...state,
      clock: {
        slot: trace.initialState.clock.slot + input.ticks.slotsPerTick * (event.tickIndex + 1n),
        timestampSeconds:
          trace.initialState.clock.timestampSeconds +
          input.ticks.secondsPerTick * (event.tickIndex + 1n),
      },
    };
    state =
      event.result.direction === "buy"
        ? executeBuy(event.result.requestedInput.amount.raw, state)
        : executeSell(event.result.requestedInput.amount.raw, state);
  }
  return state;
}

function summarizeMeasurements(
  measurements: readonly SellCascadeIteration[],
  quoteDecimals: number,
): SellCascadeMetrics {
  const outflow = summarizeBigints(measurements.map(({ quoteOutflowRaw }) => quoteOutflowRaw));
  const recovery = summarizeBigints(
    measurements.map(({ recoveryQuoteRequiredRaw }) => recoveryQuoteRequiredRaw),
  );
  return {
    maximumDrawdownBps: summarizeBigints(
      measurements.map(({ maximumDrawdownBps }) => maximumDrawdownBps),
    ),
    quoteOutflow: summarizeQuoteAmounts(outflow, quoteDecimals),
    recoveryQuoteRequired: summarizeQuoteAmounts(recovery, quoteDecimals),
    migrationDelaySeconds: summarizeBigints(
      measurements.map(({ migrationDelaySeconds }) => migrationDelaySeconds),
    ),
  };
}

function summarizeQuoteAmounts(
  summary: DistributionSummary<bigint>,
  decimals: number,
): SellCascadeMetrics["quoteOutflow"] {
  const tagged = (raw: bigint) => ({
    asset: "quote" as const,
    amount: currencyAmount(raw, decimals),
  });
  return { p05: tagged(summary.p05), median: tagged(summary.median), p95: tagged(summary.p95) };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
