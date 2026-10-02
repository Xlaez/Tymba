import type { FeeClock } from "../fees.js";
import { currencyAmount } from "../currency-amount.js";
import { MAX_CURVE_U64 } from "../curve.js";
import type {
  AttackResult,
  FeeScheduleCandidateOutcome,
  FeeScheduleTimingMetrics,
} from "../attack-result.js";
import type { AssetAmountPair, PoolState, SimulationClock } from "../pool-state.js";
import { validatePoolState } from "../pool-state-validation.js";
import { executeBuy, executeSell, quoteBuy, quoteSell } from "../simulator.js";
import { DBC_SIMULATION_ENGINE_VERSION, PINNED_SIMULATION_SDK_VERSION } from "../simulator.js";

const MAX_FEE_SCHEDULE_CANDIDATES = 10_000n;

export type FeeScheduleTimingAttackInput = Readonly<{
  id: string;
  initialState: PoolState;
  buyQuoteAtomic: bigint;
}>;

type FeeScheduleCandidateMeasurement = Readonly<{
  entryClock: SimulationClock;
  feesPaid: AssetAmountPair;
  pnlQuoteRaw: bigint;
}>;

export function runFeeScheduleTimingAttack(input: FeeScheduleTimingAttackInput): AttackResult {
  validateInput(input);
  const candidateClocks = createCandidateClocks(input.initialState);
  const candidateOutcomes: FeeScheduleCandidateOutcome[] = [];
  const measurements: FeeScheduleCandidateMeasurement[] = [];
  let completedAtSeconds = input.initialState.clock.timestampSeconds;

  for (let index = 0; index < candidateClocks.length; index += 1) {
    const entryClock = candidateClocks[index];
    if (entryClock === undefined) continue;
    const candidateIndex = BigInt(index);
    if (entryClock.timestampSeconds > completedAtSeconds) {
      completedAtSeconds = entryClock.timestampSeconds;
    }
    try {
      const measurement = measureCandidate(input.initialState, input.buyQuoteAtomic, entryClock);
      measurements.push(measurement);
      candidateOutcomes.push({
        candidateIndex,
        entryClock,
        status: "completed",
        feesPaid: measurement.feesPaid,
        pnlQuote: {
          asset: "quote",
          amount: currencyAmount(measurement.pnlQuoteRaw, input.initialState.curve.quoteDecimals),
        },
      });
    } catch (error) {
      candidateOutcomes.push({
        candidateIndex,
        entryClock,
        status: "failed",
        failure: { code: "candidate_failed", message: errorMessage(error) },
      });
    }
  }

  const completedCandidates = BigInt(measurements.length);
  const failedCandidates = BigInt(candidateOutcomes.length) - completedCandidates;
  const metadata = {
    id: input.id,
    scenario: "fee-schedule-timing" as const,
    candidateCount: BigInt(candidateClocks.length),
    completedCandidates,
    failedCandidates,
    candidateOutcomes,
    engineVersion: DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: PINNED_SIMULATION_SDK_VERSION,
    startedAtSeconds: input.initialState.clock.timestampSeconds,
    completedAtSeconds,
  };

  if (measurements.length === 0) {
    return {
      ...metadata,
      status: "failed",
      failure: {
        code: "no_completed_candidates",
        message: "No fee-schedule timing candidate completed; inspect candidate outcomes.",
      },
    };
  }

  const baseline = measurements[0];
  if (baseline === undefined) throw new RangeError("Fee-schedule baseline measurement is missing");
  let best = baseline;
  for (const measurement of measurements.slice(1)) {
    if (measurement.pnlQuoteRaw > best.pnlQuoteRaw) best = measurement;
  }
  const metrics: FeeScheduleTimingMetrics = {
    bestEntryClock: best.entryClock,
    feesSaved: {
      base: currencyAmount(
        baseline.feesPaid.base.raw - best.feesPaid.base.raw,
        baseline.feesPaid.base.decimals,
      ),
      quote: currencyAmount(
        baseline.feesPaid.quote.raw - best.feesPaid.quote.raw,
        baseline.feesPaid.quote.decimals,
      ),
    },
    pnlImprovementQuote: {
      asset: "quote",
      amount: currencyAmount(
        best.pnlQuoteRaw - baseline.pnlQuoteRaw,
        input.initialState.curve.quoteDecimals,
      ),
    },
  };

  return {
    ...metadata,
    status: failedCandidates === 0n ? "completed" : "partial",
    metrics,
  };
}

function validateInput(input: FeeScheduleTimingAttackInput): void {
  if (input.id.trim().length === 0) throw new TypeError("Attack run id must be non-empty");
  if (
    typeof input.buyQuoteAtomic !== "bigint" ||
    input.buyQuoteAtomic <= 0n ||
    input.buyQuoteAtomic > MAX_CURVE_U64
  ) {
    throw new RangeError(
      "Fee-schedule round-trip quote size must be a positive unsigned 64-bit bigint",
    );
  }
  const validation = validatePoolState(input.initialState);
  if (validation.status === "invalid") {
    throw new RangeError(
      validation.issues.map(({ path, message }) => `${path}: ${message}`).join("; "),
    );
  }
  if (input.initialState.migrationProgress !== "bonding") {
    throw new RangeError("Fee-schedule timing requires an initial bonding pool");
  }
  const schedule = input.initialState.fees.base;
  if (schedule.kind === "fixed") {
    throw new RangeError("Fee-schedule timing requires a linear or exponential base fee schedule");
  }
  if (schedule.clock !== input.initialState.activationType) {
    throw new RangeError("Fee schedule clock must match the pool activation clock");
  }
  if (schedule.periodCount <= 0n || schedule.periodCount >= MAX_FEE_SCHEDULE_CANDIDATES) {
    throw new RangeError(
      `Fee schedule period count must be between 1 and ${MAX_FEE_SCHEDULE_CANDIDATES - 1n}`,
    );
  }
  if (
    input.initialState.activationPoint + schedule.periodCount * schedule.periodFrequency >
    MAX_CURVE_U64
  ) {
    throw new RangeError("Fee schedule terminal point must fit in an unsigned 64-bit clock value");
  }
}

function createCandidateClocks(state: PoolState): SimulationClock[] {
  const schedule = state.fees.base;
  if (schedule.kind === "fixed")
    throw new RangeError("A fixed fee schedule has no timing candidates");
  const clock: FeeClock = schedule.clock;
  const currentPoint = clock === "slot" ? state.clock.slot : state.clock.timestampSeconds;
  const firstPoint = currentPoint > state.activationPoint ? currentPoint : state.activationPoint;
  const terminalPoint = state.activationPoint + schedule.periodCount * schedule.periodFrequency;
  const points = [firstPoint];
  for (let period = 0n; period <= schedule.periodCount; period += 1n) {
    const point = state.activationPoint + period * schedule.periodFrequency;
    if (point > firstPoint && point <= terminalPoint) points.push(point);
  }
  if (BigInt(points.length) > MAX_FEE_SCHEDULE_CANDIDATES) {
    throw new RangeError("Fee schedule produces too many timing candidates");
  }
  return points.map((point) =>
    clock === "slot"
      ? { ...state.clock, slot: point }
      : { ...state.clock, timestampSeconds: point },
  );
}

function measureCandidate(
  initialState: PoolState,
  buyQuoteAtomic: bigint,
  entryClock: SimulationClock,
): FeeScheduleCandidateMeasurement {
  const entryState = { ...initialState, clock: entryClock };
  const buy = quoteBuy(buyQuoteAtomic, entryState);
  if (buy.status !== "filled" || buy.consumedInput.amount.raw !== buyQuoteAtomic) {
    throw new RangeError("Buy did not fill the configured quote amount");
  }
  const stateAfterBuy = executeBuy(buyQuoteAtomic, entryState);
  const sell = quoteSell(buy.output.amount.raw, stateAfterBuy);
  if (sell.status !== "filled" || sell.consumedInput.amount.raw !== buy.output.amount.raw) {
    throw new RangeError("Round-trip sell did not fill the acquired base amount");
  }
  executeSell(buy.output.amount.raw, stateAfterBuy);
  const feesPaid = {
    base: currencyAmount(0n, initialState.curve.baseDecimals),
    quote: currencyAmount(0n, initialState.curve.quoteDecimals),
  };
  const totalFees = addFee(addFee(feesPaid, buy.fees.tradingFee), sell.fees.tradingFee);
  return {
    entryClock,
    feesPaid: totalFees,
    pnlQuoteRaw: sell.output.amount.raw - buy.consumedInput.amount.raw,
  };
}

function addFee(
  total: AssetAmountPair,
  fee: Readonly<{ asset: "base" | "quote"; amount: Readonly<{ raw: bigint }> }>,
): AssetAmountPair {
  return fee.asset === "base"
    ? { ...total, base: currencyAmount(total.base.raw + fee.amount.raw, total.base.decimals) }
    : { ...total, quote: currencyAmount(total.quote.raw + fee.amount.raw, total.quote.decimals) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
