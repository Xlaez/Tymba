import { Decimal } from "decimal.js";
import { currencyAmount } from "../currency-amount.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type {
  AttackFailure,
  AttackIterationOutcome,
  AttackResult,
  WhaleEntryMetrics,
} from "../attack-result.js";
import { createSeededRandom, createSeededRunMetadata } from "../seeded-random.js";
import type { PoolState } from "../pool-state.js";
import type { DistributionSummary } from "../simulation.js";
import { createMvpAgent } from "../simulation-agents.js";
import type { AgentDistributionConfiguration } from "../simulation-scenario.js";
import { createMvpAgentPopulation } from "../simulation-scenario.js";
import { runStochasticSimulationTrace } from "../stochastic-simulation.js";
import { DBC_SIMULATION_ENGINE_VERSION, PINNED_SIMULATION_SDK_VERSION } from "../simulator.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const BASIS_POINTS = 10_000n;
const MAX_ATTACK_ITERATIONS = 10_000n;
const MAX_ATTACK_TICKS = 10_000n;
const MAX_ATTACK_AGENT_TICK_ACTIONS = 1_000_000n;

export type WhaleEntryAttackInput = Readonly<{
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  initialState: PoolState;
  supportingAgentDistribution: AgentDistributionConfiguration;
  attacker: Readonly<{
    id: string;
    initialQuoteBalanceAtomic: bigint;
    migrationQuoteShareBps: bigint;
    entryTickIndex: bigint;
  }>;
  ticks: Readonly<{
    tickCount: bigint;
    slotsPerTick: bigint;
    secondsPerTick: bigint;
  }>;
}>;

type WhaleEntryIteration = Readonly<{
  priceDisplacementBps: bigint;
  baseAcquiredRaw: bigint;
  averageExecutionPrice: Decimal;
  postBuyConcentrationBps: bigint;
}>;

export function runWhaleEntryAttack(input: WhaleEntryAttackInput): AttackResult {
  validateInput(input);
  const seedSource = createSeededRandom(input.randomSeed);
  const outcomes: AttackIterationOutcome[] = [];
  const measurements: WhaleEntryIteration[] = [];
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
        archetype: "whale",
        initialQuoteBalanceAtomic: input.attacker.initialQuoteBalanceAtomic,
        initialBaseBalanceAtomic: 0n,
        initialBaseCostBasisQuoteAtomic: 0n,
        entryTickIndex: input.attacker.entryTickIndex,
        buyQuoteAtomic:
          (input.initialState.curve.migrationQuoteThresholdAtomic *
            input.attacker.migrationQuoteShareBps) /
          BASIS_POINTS,
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
      const measured = measureIteration(
        trace,
        input.attacker.id,
        population.agents.reduce((total, agent) => total + agent.initialBaseBalanceAtomic, 0n),
        input.initialState,
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
    scenario: "whale-entry" as const,
  };

  if (measurements.length === 0) {
    return {
      ...metadata,
      status: "failed",
      failure: {
        code: "no_completed_iterations",
        message: "No whale-entry iteration completed; inspect the retained iteration outcomes.",
      },
    };
  }

  return {
    ...metadata,
    status: partialIterations + failedIterations === 0n ? "completed" : "partial",
    metrics: summarizeMeasurements(measurements, input.initialState),
  };
}

function validateInput(input: WhaleEntryAttackInput): void {
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
    input.supportingAgentDistribution.counts.whale !== 0n
  ) {
    throw new RangeError("Whale-entry requires a bonding pool and no supporting whale agents");
  }
  createMvpAgentPopulation(input.supportingAgentDistribution);
  if (
    typeof input.attacker.migrationQuoteShareBps !== "bigint" ||
    input.attacker.migrationQuoteShareBps <= 0n ||
    input.attacker.migrationQuoteShareBps > BASIS_POINTS
  ) {
    throw new RangeError("Whale migration-quote share must be between 1 and 10000 basis points");
  }
  const buyQuoteAtomic =
    (input.initialState.curve.migrationQuoteThresholdAtomic *
      input.attacker.migrationQuoteShareBps) /
    BASIS_POINTS;
  if (buyQuoteAtomic <= 0n || buyQuoteAtomic > MAX_CURVE_U64) {
    throw new RangeError("Whale buy size must be a positive unsigned 64-bit amount");
  }
  if (
    typeof input.attacker.initialQuoteBalanceAtomic !== "bigint" ||
    input.attacker.initialQuoteBalanceAtomic < buyQuoteAtomic ||
    input.attacker.initialQuoteBalanceAtomic > MAX_CURVE_U64
  ) {
    throw new RangeError("Whale quote balance must fund the configured migration-quote share");
  }
  if (
    typeof input.attacker.entryTickIndex !== "bigint" ||
    input.attacker.entryTickIndex < 0n ||
    input.attacker.entryTickIndex >= input.ticks.tickCount
  ) {
    throw new RangeError("Whale entry tick must be within the configured tick range");
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
      `Whale-entry run exceeds the ${MAX_ATTACK_AGENT_TICK_ACTIONS} agent-tick action budget`,
    );
  }
}

function measureIteration(
  trace: ReturnType<typeof runStochasticSimulationTrace>,
  attackerId: string,
  initialTrackedBaseAtomic: bigint,
  initialState: PoolState,
): Readonly<{ measurement?: WhaleEntryIteration; failure?: AttackFailure }> {
  const entryIndex = trace.events.findIndex(
    (event) =>
      event.kind === "trade-executed" &&
      event.agentId === attackerId &&
      event.result.direction === "buy",
  );
  if (entryIndex < 0) {
    return {
      failure: {
        code: "whale_entry_not_observed",
        message: "The whale did not execute its configured purchase within the configured ticks.",
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
  const entry = trace.events[entryIndex];
  if (entry?.kind !== "trade-executed" || entry.result.direction !== "buy") {
    throw new RangeError("Whale entry event has an invalid trade direction");
  }

  let trackedBaseBefore = initialTrackedBaseAtomic;
  for (const event of trace.events.slice(0, entryIndex)) {
    if (event.kind !== "trade-executed") continue;
    trackedBaseBefore +=
      event.result.direction === "buy"
        ? event.result.output.amount.raw
        : -event.result.consumedInput.amount.raw;
  }
  const baseAcquiredRaw = entry.result.output.amount.raw;
  const trackedBaseAfter = trackedBaseBefore + baseAcquiredRaw;
  const displacement = new ExactDecimal(entry.result.metrics.spotPriceAfter.toString())
    .minus(entry.result.metrics.spotPriceBefore)
    .mul(BASIS_POINTS.toString())
    .div(entry.result.metrics.spotPriceBefore)
    .floor();
  const averageExecutionPrice = new ExactDecimal(entry.result.consumedInput.amount.raw.toString())
    .mul(new ExactDecimal(10).pow(initialState.curve.baseDecimals))
    .div(
      new ExactDecimal(baseAcquiredRaw.toString()).mul(
        new ExactDecimal(10).pow(initialState.curve.quoteDecimals),
      ),
    );

  return {
    measurement: {
      priceDisplacementBps: BigInt(displacement.toFixed(0)),
      baseAcquiredRaw,
      averageExecutionPrice,
      postBuyConcentrationBps:
        trackedBaseAfter === 0n ? 0n : (baseAcquiredRaw * BASIS_POINTS) / trackedBaseAfter,
    },
  };
}

function summarizeMeasurements(
  measurements: readonly WhaleEntryIteration[],
  state: PoolState,
): WhaleEntryMetrics {
  const prices = summarizeValues(
    measurements.map(({ averageExecutionPrice }) => averageExecutionPrice),
    (left, right) => left.comparedTo(right),
  );
  const base = summarizeBigints(measurements.map(({ baseAcquiredRaw }) => baseAcquiredRaw));
  return {
    priceDisplacementBps: summarizeBigints(
      measurements.map(({ priceDisplacementBps }) => priceDisplacementBps),
    ),
    baseAcquired: {
      p05: { asset: "base", amount: currencyAmount(base.p05, state.curve.baseDecimals) },
      median: { asset: "base", amount: currencyAmount(base.median, state.curve.baseDecimals) },
      p95: { asset: "base", amount: currencyAmount(base.p95, state.curve.baseDecimals) },
    },
    averageExecutionPrice: prices,
    postBuyConcentrationBps: summarizeBigints(
      measurements.map(({ postBuyConcentrationBps }) => postBuyConcentrationBps),
    ),
  };
}

function summarizeBigints(values: readonly bigint[]): DistributionSummary<bigint> {
  return summarizeValues(values, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function summarizeValues<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
): DistributionSummary<Value> {
  if (values.length === 0) throw new RangeError("Cannot summarize an empty attack sample");
  const sorted = [...values].sort(compare);
  return {
    p05: rankedValue(sorted, nearestRankIndex(sorted.length, 500n)),
    median: rankedValue(sorted, nearestRankIndex(sorted.length, 5_000n)),
    p95: rankedValue(sorted, nearestRankIndex(sorted.length, 9_500n)),
  };
}

function rankedValue<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) throw new RangeError("Attack percentile rank is outside the sample");
  return value;
}

function nearestRankIndex(sampleSize: number, percentileBps: bigint): number {
  const count = BigInt(sampleSize);
  const rank = (count * percentileBps + BASIS_POINTS - 1n) / BASIS_POINTS;
  return Number(rank > 0n ? rank - 1n : 0n);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
