import type { AttackResult } from "./attack-result.js";
import type { FeeScheduleTimingAttackInput } from "./attacks/fee-schedule-timing.js";
import { runFeeScheduleTimingAttack } from "./attacks/fee-schedule-timing.js";
import type { OpeningSniperAttackInput } from "./attacks/opening-sniper.js";
import { runOpeningSniperAttack } from "./attacks/opening-sniper.js";
import type { PumpAndDumpAttackInput } from "./attacks/pump-and-dump.js";
import { runPumpAndDumpAttack } from "./attacks/pump-and-dump.js";
import type { SellCascadeAttackInput } from "./attacks/sell-cascade.js";
import { runSellCascadeAttack } from "./attacks/sell-cascade.js";
import type { WhaleEntryAttackInput } from "./attacks/whale-entry.js";
import { runWhaleEntryAttack } from "./attacks/whale-entry.js";
import { MAX_CURVE_U64 } from "./curve.js";
import type {
  DeterministicSimulationResult,
  FailedStochasticSimulationResult,
  StochasticSimulationResult,
} from "./simulation.js";
import { runMonteCarloSimulation } from "./monte-carlo.js";
import type { DeterministicTradeInput } from "./simulator.js";
import { executeBuy, quoteBuy, runDeterministicSimulation } from "./simulator.js";
import type { StochasticScenarioConfiguration } from "./simulation-scenario.js";
import type { HardenedCandidateGenerationResult } from "./harden-market-candidate.js";
import type { PoolState } from "./pool-state.js";

export type HardeningAttackReplayConfiguration =
  | Readonly<{
      scenario: "opening-sniper";
      id: string;
      configuration: Omit<OpeningSniperAttackInput, "id" | "initialState">;
    }>
  | Readonly<{
      scenario: "whale-entry";
      id: string;
      configuration: Omit<WhaleEntryAttackInput, "id" | "initialState">;
    }>
  | Readonly<{
      scenario: "pump-and-dump";
      id: string;
      configuration: Omit<PumpAndDumpAttackInput, "id" | "initialState">;
    }>
  | Readonly<{
      scenario: "sell-cascade";
      id: string;
      configuration: Omit<SellCascadeAttackInput, "id" | "initialState">;
    }>
  | Readonly<{
      scenario: "fee-schedule-timing";
      id: string;
      configuration: Omit<FeeScheduleTimingAttackInput, "id" | "initialState">;
    }>;

export type HardeningReplayConfiguration = Readonly<{
  deterministic: Readonly<{
    id: string;
    trades: readonly DeterministicTradeInput[];
  }>;
  stochastic: Omit<StochasticScenarioConfiguration, "initialState"> &
    Readonly<{ requestedIterations: bigint }>;
  attacks: readonly HardeningAttackReplayConfiguration[];
  warmupQuoteAtomic?: bigint;
}>;

export type ReplayFailure = Readonly<{ code: string; message: string }>;

export type ReplayAttempt<Result> =
  | Readonly<{ status: "completed"; result: Result }>
  | Readonly<{ status: "failed"; failure: ReplayFailure }>;

export type AttackReplayAttempt = Readonly<{
  scenario: HardeningAttackReplayConfiguration["scenario"];
  id: string;
  attempt: ReplayAttempt<AttackResult>;
}>;

export type CandidateResimulationResult = Readonly<{
  candidateId: string;
  deterministic: ReplayAttempt<DeterministicSimulationResult>;
  stochastic: ReplayAttempt<StochasticSimulationResult | FailedStochasticSimulationResult>;
  attacks: readonly AttackReplayAttempt[];
}>;

export type HardeningResimulationResult = Readonly<{
  status: "completed" | "partial" | "failed";
  originalCandidateId: string;
  hardenedCandidateId: string;
  replayConfiguration: HardeningReplayConfiguration;
  baseline: CandidateResimulationResult;
  hardened: CandidateResimulationResult;
}>;

export function resimulateHardenedCandidate(
  generation: HardenedCandidateGenerationResult,
  replayConfiguration: HardeningReplayConfiguration,
): HardeningResimulationResult {
  validateInput(generation, replayConfiguration);
  const baseline = replayCandidate(generation.originalCandidate, replayConfiguration, "baseline");
  const hardenedCandidate = generation.hardenedCandidate;
  if (!hardenedCandidate) throw new TypeError("A generated hardened candidate is required");
  const hardened = replayCandidate(hardenedCandidate, replayConfiguration, "hardened");
  const replayStatuses = [aggregateCandidateStatus(baseline), aggregateCandidateStatus(hardened)];
  return {
    status: replayStatuses.every((status) => status === "failed")
      ? "failed"
      : replayStatuses.some((status) => status !== "completed")
        ? "partial"
        : "completed",
    originalCandidateId: generation.originalCandidate.id,
    hardenedCandidateId: hardenedCandidate.id,
    replayConfiguration,
    baseline,
    hardened,
  };
}

function replayCandidate(
  candidate: HardenedCandidateGenerationResult["originalCandidate"],
  configuration: HardeningReplayConfiguration,
  label: "baseline" | "hardened",
): CandidateResimulationResult {
  const prefix = `${configuration.deterministic.id}-${label}-${candidate.id}`;
  let initialState: PoolState;
  try {
    initialState = prepareInitialState(candidate.simulation.initialState, configuration);
  } catch (error) {
    const failure: ReplayFailure = {
      code: "initial_state_preparation_failed",
      message: errorMessage(error),
    };
    return {
      candidateId: candidate.id,
      deterministic: { status: "failed", failure },
      stochastic: { status: "failed", failure },
      attacks: configuration.attacks.map((attack) => ({
        scenario: attack.scenario,
        id: `${attack.id}-${label}-${candidate.id}`,
        attempt: { status: "failed", failure },
      })),
    };
  }
  const deterministic = attempt(() =>
    runDeterministicSimulation({
      id: prefix,
      initialState,
      trades: configuration.deterministic.trades,
    }),
  );
  const stochastic = attempt(() =>
    runMonteCarloSimulation({
      ...configuration.stochastic,
      id: `${configuration.stochastic.id}-${label}-${candidate.id}`,
      initialState,
    }),
  );
  const attacks = configuration.attacks.map((attack) => ({
    scenario: attack.scenario,
    id: `${attack.id}-${label}-${candidate.id}`,
    attempt: attempt(() =>
      runAttack(attack, initialState, `${attack.id}-${label}-${candidate.id}`),
    ),
  }));
  return { candidateId: candidate.id, deterministic, stochastic, attacks };
}

function prepareInitialState(
  initialState: PoolState,
  configuration: HardeningReplayConfiguration,
): PoolState {
  const warmupQuoteAtomic = configuration.warmupQuoteAtomic;
  if (warmupQuoteAtomic === undefined) return initialState;
  const warmup = quoteBuy(warmupQuoteAtomic, initialState);
  if (warmup.status !== "filled" || warmup.consumedInput.amount.raw !== warmupQuoteAtomic) {
    throw new RangeError("Hardening warm-up quote must fill exactly on both candidate curves");
  }
  return executeBuy(warmupQuoteAtomic, initialState);
}

function runAttack(
  attack: HardeningAttackReplayConfiguration,
  initialState: PoolState,
  id: string,
): AttackResult {
  switch (attack.scenario) {
    case "opening-sniper":
      return runOpeningSniperAttack({ ...attack.configuration, id, initialState });
    case "whale-entry":
      return runWhaleEntryAttack({ ...attack.configuration, id, initialState });
    case "pump-and-dump":
      return runPumpAndDumpAttack({ ...attack.configuration, id, initialState });
    case "sell-cascade":
      return runSellCascadeAttack({ ...attack.configuration, id, initialState });
    case "fee-schedule-timing":
      return runFeeScheduleTimingAttack({ ...attack.configuration, id, initialState });
  }
}

function attempt<Result>(action: () => Result): ReplayAttempt<Result> {
  try {
    return { status: "completed", result: action() };
  } catch (error) {
    return {
      status: "failed",
      failure: { code: "replay_failed", message: errorMessage(error) },
    };
  }
}

function aggregateCandidateStatus(
  result: CandidateResimulationResult,
): "completed" | "partial" | "failed" {
  const attempts = [
    result.deterministic,
    result.stochastic,
    ...result.attacks.map(({ attempt }) => attempt),
  ];
  const successfulCount = attempts.filter(
    (attempt) => attempt.status === "completed" && attempt.result.status !== "failed",
  ).length;
  if (successfulCount === 0) return "failed";
  if (
    successfulCount !== attempts.length ||
    attempts.some(
      (attempt) => attempt.status === "completed" && attempt.result.status === "partial",
    )
  ) {
    return "partial";
  }
  return "completed";
}

function validateInput(
  generation: HardenedCandidateGenerationResult,
  configuration: HardeningReplayConfiguration,
): void {
  if (typeof generation !== "object" || generation === null || Array.isArray(generation)) {
    throw new TypeError("Hardened candidate generation result is required");
  }
  if (generation.status === "unsatisfied" || !generation.hardenedCandidate) {
    throw new TypeError("A generated hardened candidate is required for replay");
  }
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    throw new TypeError("Hardening replay configuration is required");
  }
  if (
    typeof configuration.deterministic.id !== "string" ||
    configuration.deterministic.id.trim().length === 0 ||
    !Array.isArray(configuration.deterministic.trades) ||
    configuration.deterministic.trades.length === 0
  ) {
    throw new TypeError("Hardening deterministic replay requires an id and at least one trade");
  }
  if (
    typeof configuration.stochastic.id !== "string" ||
    configuration.stochastic.id.trim().length === 0 ||
    typeof configuration.stochastic.randomSeed !== "bigint" ||
    typeof configuration.stochastic.requestedIterations !== "bigint" ||
    configuration.stochastic.requestedIterations <= 0n
  ) {
    throw new TypeError(
      "Hardening stochastic replay requires an id, seed, and positive iteration count",
    );
  }
  if (!Array.isArray(configuration.attacks) || configuration.attacks.length === 0) {
    throw new TypeError("At least one hardening attack replay is required");
  }
  const attackIds = configuration.attacks.map(({ id }) => id);
  if (attackIds.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    throw new TypeError("Hardening attack replay ids must be non-empty");
  }
  if (new Set(attackIds).size !== attackIds.length) {
    throw new RangeError("Hardening attack replay ids must be unique");
  }
  if (
    configuration.warmupQuoteAtomic !== undefined &&
    (typeof configuration.warmupQuoteAtomic !== "bigint" ||
      configuration.warmupQuoteAtomic <= 0n ||
      configuration.warmupQuoteAtomic > MAX_CURVE_U64)
  ) {
    throw new RangeError("Hardening warm-up quote must be a positive u64 bigint");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Hardening scenario replay failed";
}
