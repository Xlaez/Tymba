import { Decimal } from "decimal.js";
import { currencyAmount } from "./currency-amount.js";
import type { AssetAmount, AssetAmountPair } from "./pool-state.js";
import type {
  DistributionSummary,
  FailedStochasticSimulationResult,
  SimulationFailure,
  SimulationUncertainty,
  SimulationUncertaintyReason,
  StochasticIterationOutcome,
  StochasticSimulationResult,
} from "./simulation.js";
import { createSeededRandom, createSeededRunMetadata } from "./seeded-random.js";
import {
  DBC_SIMULATION_ENGINE_VERSION,
  getSpotPrice,
  PINNED_SIMULATION_SDK_VERSION,
} from "./simulator.js";
import { createStochasticSimulationInput } from "./simulation-scenario.js";
import type { StochasticScenarioConfiguration } from "./simulation-scenario.js";
import { createMvpAgentPopulation } from "./simulation-scenario.js";
import { runStochasticSimulationTrace } from "./stochastic-simulation.js";

export const MAX_MVP_MONTE_CARLO_ITERATIONS = 10_000n;

export type MonteCarloSimulationInput = StochasticScenarioConfiguration &
  Readonly<{ requestedIterations: bigint }>;

type IterationMeasurements = Readonly<{
  graduated: boolean;
  quoteAccumulatedRaw: bigint;
  baseDistributedRaw: bigint;
  timeToMigrationSeconds?: bigint;
  maximumDrawdownBps: bigint;
  maximumPriceImpactBps: bigint;
  feesGenerated: AssetAmountPair;
  creatorFees: AssetAmountPair;
  topHolderConcentrationBps: bigint;
  topTenHolderConcentrationBps: bigint;
  sniperExtractionQuoteRaw?: bigint;
}>;

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const PERCENTILE_DENOMINATOR = 10_000n;
const P05_BPS = 500n;
const P50_BPS = 5_000n;
const P95_BPS = 9_500n;
const MINIMUM_CONFIDENT_SAMPLE = 30n;
const MODERATE_SPREAD_BPS = 2_000n;
const HIGH_SPREAD_BPS = 5_000n;

export function runMonteCarloSimulation(
  input: MonteCarloSimulationInput,
): StochasticSimulationResult | FailedStochasticSimulationResult {
  validateMonteCarloInput(input);
  const agentCounts = createMvpAgentPopulation(input.agentDistribution).agentCounts;
  const seedSource = createSeededRandom(input.randomSeed);
  const completedMeasurements: IterationMeasurements[] = [];
  const iterationOutcomes: StochasticIterationOutcome[] = [];
  let partialIterations = 0n;
  let failedIterations = 0n;
  let completedAtSeconds = input.initialState.clock.timestampSeconds;

  for (let iterationIndex = 0n; iterationIndex < input.requestedIterations; iterationIndex += 1n) {
    const iterationId = `${input.id}-iteration-${iterationIndex}`;
    const iterationSeed = seedSource.nextUint64();
    try {
      const iterationInput = createStochasticSimulationInput({
        ...input,
        id: iterationId,
        randomSeed: iterationSeed,
      });
      const trace = runStochasticSimulationTrace(iterationInput);
      const failure = firstAgentFailure(trace.events);
      if (trace.status === "partial") partialIterations += 1n;
      else {
        completedMeasurements.push(measureIteration(trace, iterationInput.agents));
      }
      if (trace.completedAtSeconds > completedAtSeconds) {
        completedAtSeconds = trace.completedAtSeconds;
      }
      iterationOutcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: trace.status,
        completedTicks: trace.completedTicks,
        ...(failure === undefined ? {} : { failure }),
      });
    } catch (error) {
      failedIterations += 1n;
      iterationOutcomes.push({
        ...createSeededRunMetadata(iterationSeed),
        id: iterationId,
        status: "failed",
        completedTicks: 0n,
        failure: { code: "iteration_failed", message: errorMessage(error) },
      });
    }
  }

  const completedIterations = BigInt(completedMeasurements.length);
  const uncertainty = classifyUncertainty(
    input.requestedIterations,
    completedMeasurements,
    partialIterations,
    failedIterations,
  );
  const common = {
    ...createSeededRunMetadata(input.randomSeed),
    id: input.id,
    engineVersion: DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: PINNED_SIMULATION_SDK_VERSION,
    startedAtSeconds: input.initialState.clock.timestampSeconds,
    completedAtSeconds,
    kind: "stochastic" as const,
    requestedIterations: input.requestedIterations,
    completedIterations,
    partialIterations,
    failedIterations,
    agentCounts,
    iterationOutcomes,
    uncertainty,
  };

  if (completedMeasurements.length === 0) {
    return {
      ...common,
      status: "failed",
      completedIterations: 0n,
      failure: {
        code: "no_completed_iterations",
        message: "No Monte Carlo iteration completed; inspect the retained iteration outcomes.",
      },
    };
  }

  return {
    ...common,
    status: partialIterations + failedIterations === 0n ? "completed" : "partial",
    summary: summarizeMeasurements(
      completedMeasurements,
      input.initialState.curve.baseDecimals,
      input.initialState.curve.quoteDecimals,
    ),
  };
}

function validateMonteCarloInput(input: MonteCarloSimulationInput): void {
  if (input.id.trim().length === 0) throw new TypeError("Monte Carlo run id must be non-empty");
  createSeededRunMetadata(input.randomSeed);
  if (
    typeof input.requestedIterations !== "bigint" ||
    input.requestedIterations <= 0n ||
    input.requestedIterations > MAX_MVP_MONTE_CARLO_ITERATIONS
  ) {
    throw new RangeError(
      `Requested iterations must be between 1 and ${MAX_MVP_MONTE_CARLO_ITERATIONS}`,
    );
  }
}

function measureIteration(
  trace: ReturnType<typeof runStochasticSimulationTrace>,
  agents: ReturnType<typeof createStochasticSimulationInput>["agents"],
): IterationMeasurements {
  const initial = trace.initialState;
  const final = trace.finalState;
  const graduated = final.migrationProgress !== "bonding";
  const migrationSeconds = final.clock.timestampSeconds - initial.clock.timestampSeconds;
  let peakPrice = getSpotPrice(initial);
  let maximumDrawdownBps = 0n;
  let maximumPriceImpactBps = 0n;
  for (const event of trace.events) {
    if (event.kind !== "trade-executed") continue;
    const after = event.result.metrics.spotPriceAfter;
    if (event.result.metrics.priceImpactBps > maximumPriceImpactBps) {
      maximumPriceImpactBps = event.result.metrics.priceImpactBps;
    }
    if (after.greaterThan(peakPrice)) peakPrice = after;
    if (peakPrice.greaterThan(after)) {
      const drawdownBps = BigInt(
        new ExactDecimal(peakPrice.minus(after).toString())
          .mul(PERCENTILE_DENOMINATOR.toString())
          .div(peakPrice.toString())
          .floor()
          .toFixed(0),
      );
      if (drawdownBps > maximumDrawdownBps) maximumDrawdownBps = drawdownBps;
    }
  }

  const initialTradingFees = initial.ledger.fees.totalTrading;
  const finalTradingFees = final.ledger.fees.totalTrading;
  const initialCreatorFees = initial.ledger.fees.creator;
  const finalCreatorFees = final.ledger.fees.creator;
  const topBalances = trace.portfolios.map(({ baseBalanceAtomic }) => baseBalanceAtomic);
  const totalTrackedBase = topBalances.reduce((total, value) => total + value, 0n);
  const descendingBalances = [...topBalances].sort((left, right) =>
    left === right ? 0 : left > right ? -1 : 1,
  );
  const concentration = (raw: bigint): bigint =>
    totalTrackedBase === 0n ? 0n : (raw * PERCENTILE_DENOMINATOR) / totalTrackedBase;
  const topHolderConcentrationBps = concentration(descendingBalances[0] ?? 0n);
  const topTenHolderConcentrationBps = concentration(
    descendingBalances.slice(0, 10).reduce((total, value) => total + value, 0n),
  );
  const finalPrice = getSpotPrice(final);
  const initialAgents = new Map(agents.map((agent) => [agent.id, agent]));
  const sniperExtractionQuoteRaw = trace.portfolios.reduce((total, portfolio) => {
    if (portfolio.archetype !== "sniper") return total;
    const initialAgent = initialAgents.get(portfolio.agentId);
    if (!initialAgent) return total;
    const markedBaseValue = new ExactDecimal(finalPrice.toString())
      .mul(portfolio.baseBalanceAtomic.toString())
      .mul(new ExactDecimal(10).pow(final.curve.quoteDecimals))
      .div(new ExactDecimal(10).pow(final.curve.baseDecimals))
      .floor();
    const pnl =
      BigInt(markedBaseValue.toFixed(0)) +
      portfolio.quoteBalanceAtomic -
      initialAgent.initialQuoteBalanceAtomic -
      initialAgent.initialBaseCostBasisQuoteAtomic;
    return total + pnl;
  }, 0n);

  return {
    graduated,
    quoteAccumulatedRaw: final.ledger.pool.quote.raw - initial.ledger.pool.quote.raw,
    baseDistributedRaw:
      final.supply.baseDistributed.amount.raw - initial.supply.baseDistributed.amount.raw,
    ...(graduated ? { timeToMigrationSeconds: migrationSeconds } : {}),
    maximumDrawdownBps,
    maximumPriceImpactBps,
    feesGenerated: {
      base: currencyAmount(
        finalTradingFees.base.raw - initialTradingFees.base.raw,
        final.curve.baseDecimals,
      ),
      quote: currencyAmount(
        finalTradingFees.quote.raw - initialTradingFees.quote.raw,
        final.curve.quoteDecimals,
      ),
    },
    creatorFees: {
      base: currencyAmount(
        finalCreatorFees.base.raw - initialCreatorFees.base.raw,
        final.curve.baseDecimals,
      ),
      quote: currencyAmount(
        finalCreatorFees.quote.raw - initialCreatorFees.quote.raw,
        final.curve.quoteDecimals,
      ),
    },
    topHolderConcentrationBps,
    topTenHolderConcentrationBps,
    ...(trace.portfolios.some(({ archetype }) => archetype === "sniper")
      ? { sniperExtractionQuoteRaw }
      : {}),
  };
}

function summarizeMeasurements(
  measurements: readonly IterationMeasurements[],
  baseDecimals: number,
  quoteDecimals: number,
): StochasticSimulationResult["summary"] {
  const graduated = measurements.filter((measurement) => measurement.graduated).length;
  const migrationTimes = measurements.flatMap((measurement) =>
    measurement.timeToMigrationSeconds === undefined ? [] : [measurement.timeToMigrationSeconds],
  );
  const hasSnipers = measurements.some(
    (measurement) => measurement.sniperExtractionQuoteRaw !== undefined,
  );
  const quoteValues = measurements.map((measurement) => measurement.quoteAccumulatedRaw);
  const baseValues = measurements.map((measurement) => measurement.baseDistributedRaw);
  const fees = measurements.map((measurement) => measurement.feesGenerated);
  const creatorFees = measurements.map((measurement) => measurement.creatorFees);
  return {
    graduationFrequencyBps:
      (BigInt(graduated) * PERCENTILE_DENOMINATOR) / BigInt(measurements.length),
    quoteAccumulated: summarizeAssetAmounts(quoteValues, quoteDecimals, "quote"),
    baseDistributed: summarizeAssetAmounts(baseValues, baseDecimals, "base"),
    ...(migrationTimes.length > 0
      ? { timeToMigrationSeconds: summarizeBigints(migrationTimes) }
      : {}),
    maximumDrawdownBps: summarizeBigints(
      measurements.map(({ maximumDrawdownBps }) => maximumDrawdownBps),
    ),
    maximumPriceImpactBps: summarizeBigints(
      measurements.map(({ maximumPriceImpactBps }) => maximumPriceImpactBps),
    ),
    ...(measurements.some(({ topHolderConcentrationBps }) => topHolderConcentrationBps > 0n)
      ? {
          topHolderConcentrationBps: summarizeBigints(
            measurements.map(({ topHolderConcentrationBps }) => topHolderConcentrationBps),
          ),
          topTenHolderConcentrationBps: summarizeBigints(
            measurements.map(({ topTenHolderConcentrationBps }) => topTenHolderConcentrationBps),
          ),
        }
      : {}),
    feesGenerated: summarizeFeePairs(fees),
    creatorFees: summarizeFeePairs(creatorFees),
    ...(hasSnipers
      ? {
          sniperExtractionQuote: summarizeAssetAmounts(
            measurements.map(({ sniperExtractionQuoteRaw }) => sniperExtractionQuoteRaw ?? 0n),
            quoteDecimals,
            "quote",
          ),
        }
      : {}),
  };
}

function summarizeAssetAmounts<Asset extends "base" | "quote">(
  values: readonly bigint[],
  decimals: number,
  asset: Asset,
): DistributionSummary<AssetAmount<Asset>> {
  const summary = summarizeBigints(values);
  const tagged = (raw: bigint): AssetAmount<Asset> => ({
    asset,
    amount: currencyAmount(raw, decimals),
  });
  return {
    p05: tagged(summary.p05),
    median: tagged(summary.median),
    p95: tagged(summary.p95),
  };
}

function summarizeFeePairs(
  values: readonly AssetAmountPair[],
): DistributionSummary<AssetAmountPair> {
  const summary = summarizeValues(values, (left, right) => {
    if (left.base.raw !== right.base.raw) return left.base.raw < right.base.raw ? -1 : 1;
    if (left.quote.raw !== right.quote.raw) return left.quote.raw < right.quote.raw ? -1 : 1;
    return 0;
  });
  return summary;
}

function summarizeBigints(values: readonly bigint[]): DistributionSummary<bigint> {
  return summarizeValues(values, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function summarizeValues<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
): DistributionSummary<Value> {
  if (values.length === 0) throw new RangeError("Cannot summarize an empty Monte Carlo sample");
  const sorted = [...values].sort(compare);
  return {
    p05: sorted[nearestRankIndex(sorted.length, P05_BPS)],
    median: sorted[nearestRankIndex(sorted.length, P50_BPS)],
    p95: sorted[nearestRankIndex(sorted.length, P95_BPS)],
  } as DistributionSummary<Value>;
}

function nearestRankIndex(sampleSize: number, percentileBps: bigint): number {
  const sampleSizeBigint = BigInt(sampleSize);
  const rank =
    (sampleSizeBigint * percentileBps + PERCENTILE_DENOMINATOR - 1n) / PERCENTILE_DENOMINATOR;
  return Number(rank > 0n ? rank - 1n : 0n);
}

function classifyUncertainty(
  requestedIterations: bigint,
  measurements: readonly IterationMeasurements[],
  partialIterations: bigint,
  failedIterations: bigint,
): SimulationUncertainty {
  const completedSampleSize = BigInt(measurements.length);
  const completionRateBps = (completedSampleSize * PERCENTILE_DENOMINATOR) / requestedIterations;
  const reasons: SimulationUncertaintyReason[] = [];
  const incompleteCount = partialIterations + failedIterations;
  const relativeSpreadBps =
    measurements.length === 0 ? undefined : maximumRelativeSpreadBps(measurements);
  if (completedSampleSize < MINIMUM_CONFIDENT_SAMPLE) {
    reasons.push("fewer-than-30-completed-runs");
  }
  if (incompleteCount > 0n) reasons.push("partial-or-failed-runs");
  if (relativeSpreadBps !== undefined && relativeSpreadBps >= MODERATE_SPREAD_BPS) {
    reasons.push("wide-outcome-spread");
  }
  let label: SimulationUncertainty["label"];
  if (completedSampleSize < MINIMUM_CONFIDENT_SAMPLE) label = "insufficient-data";
  else if (
    incompleteCount > 0n ||
    (relativeSpreadBps !== undefined && relativeSpreadBps >= HIGH_SPREAD_BPS)
  ) {
    label = "high";
  } else if (relativeSpreadBps !== undefined && relativeSpreadBps >= MODERATE_SPREAD_BPS) {
    label = "moderate";
  } else {
    label = "low";
  }
  return {
    label,
    reasons,
    requestedSampleSize: requestedIterations,
    completedSampleSize,
    completionRateBps,
    ...(relativeSpreadBps === undefined ? {} : { relativeSpreadBps }),
  };
}

function maximumRelativeSpreadBps(measurements: readonly IterationMeasurements[]): bigint {
  const scalarSamples: bigint[][] = [
    measurements.map(({ graduated }) => (graduated ? PERCENTILE_DENOMINATOR : 0n)),
    measurements.map(({ quoteAccumulatedRaw }) => quoteAccumulatedRaw),
    measurements.map(({ baseDistributedRaw }) => baseDistributedRaw),
    measurements.map(({ maximumDrawdownBps }) => maximumDrawdownBps),
    measurements.map(({ maximumPriceImpactBps }) => maximumPriceImpactBps),
    measurements.map(({ topHolderConcentrationBps }) => topHolderConcentrationBps),
    measurements.map(({ topTenHolderConcentrationBps }) => topTenHolderConcentrationBps),
    measurements.map(({ feesGenerated }) => feesGenerated.base.raw),
    measurements.map(({ feesGenerated }) => feesGenerated.quote.raw),
    measurements.map(({ creatorFees }) => creatorFees.base.raw),
    measurements.map(({ creatorFees }) => creatorFees.quote.raw),
  ];
  if (measurements.some(({ sniperExtractionQuoteRaw }) => sniperExtractionQuoteRaw !== undefined)) {
    scalarSamples.push(
      measurements.map(({ sniperExtractionQuoteRaw }) => sniperExtractionQuoteRaw ?? 0n),
    );
  }
  return scalarSamples.reduce((maximum, values) => {
    const summary = summarizeBigints(values);
    const denominator = maxBigint(
      absBigint(summary.p05),
      absBigint(summary.median),
      absBigint(summary.p95),
      1n,
    );
    const spread = ((summary.p95 - summary.p05) * PERCENTILE_DENOMINATOR) / denominator;
    return spread > maximum ? spread : maximum;
  }, 0n);
}

function firstAgentFailure(
  events: ReturnType<typeof runStochasticSimulationTrace>["events"],
): SimulationFailure | undefined {
  const failure = events.find((event) => event.kind === "agent-failed");
  return failure?.kind === "agent-failed"
    ? { code: "agent_failed", message: failure.message }
    : undefined;
}

function maxBigint(...values: bigint[]): bigint {
  return values.reduce((maximum, value) => (value > maximum ? value : maximum), values[0] ?? 0n);
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
