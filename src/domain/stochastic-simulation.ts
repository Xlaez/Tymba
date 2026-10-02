import { Decimal } from "decimal.js";
import type { AgentArchetype } from "./simulation.js";
import { MAX_CURVE_U64 } from "./curve.js";
import { calculateMigrationQuoteAccounting } from "./migration-math.js";
import type { PoolState, SimulationClock } from "./pool-state.js";
import { validatePoolState } from "./pool-state-validation.js";
import {
  createSeededRandom,
  createSeededRunMetadata,
  type SeededRunMetadata,
  type SeededRandom,
} from "./seeded-random.js";
import {
  DBC_SIMULATION_ENGINE_VERSION,
  executeBuy,
  executeSell,
  getSpotPrice,
  PINNED_SIMULATION_SDK_VERSION,
  quoteBuy,
  quoteSell,
} from "./simulator.js";
import type { TradeResult } from "./trade-result.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });

export type SimulationAction =
  | Readonly<{ kind: "wait" }>
  | Readonly<{ kind: "buy" | "sell"; inputAtomic: bigint }>;

export type SimulationExecutionOrder = "configured" | "seeded-random";

export type SimulationObservation = Readonly<{
  tickIndex: bigint;
  clock: SimulationClock;
  state: PoolState;
  spotPrice: Decimal;
  migrationProgressBps: bigint;
  cumulativeBaseBoughtAtomicByArchetype: Readonly<Record<AgentArchetype, bigint>>;
}>;

export type AgentPortfolioObservation = Readonly<{
  quoteBalanceAtomic: bigint;
  baseBalanceAtomic: bigint;
  baseCostBasisQuoteAtomic: bigint;
  successfulBuyCount: bigint;
  successfulSellCount: bigint;
  firstBuyTickIndex?: bigint;
  averageEntryPrice?: Decimal;
  peakSpotPrice: Decimal;
}>;

export type SimulationAgentObservation = SimulationObservation &
  Readonly<{ portfolio: AgentPortfolioObservation }>;

export type SimulationAgent = Readonly<{
  id: string;
  archetype: AgentArchetype;
  initialQuoteBalanceAtomic: bigint;
  initialBaseBalanceAtomic: bigint;
  initialBaseCostBasisQuoteAtomic: bigint;
  decide: (observation: SimulationAgentObservation, random: SeededRandom) => SimulationAction;
}>;

export type AgentPortfolioResult = AgentPortfolioObservation &
  Readonly<{
    agentId: string;
    archetype: AgentArchetype;
  }>;

type MutableAgentPortfolio = {
  quoteBalanceAtomic: bigint;
  baseBalanceAtomic: bigint;
  baseCostBasisQuoteAtomic: bigint;
  successfulBuyCount: bigint;
  successfulSellCount: bigint;
  firstBuyTickIndex?: bigint;
  peakSpotPrice: Decimal;
};

export type StochasticTickConfiguration = Readonly<{
  tickCount: bigint;
  slotsPerTick: bigint;
  secondsPerTick: bigint;
  executionOrder: SimulationExecutionOrder;
}>;

export type StochasticSimulationEvent =
  | Readonly<{
      kind: "tick-observed";
      tickIndex: bigint;
      clock: SimulationClock;
      spotPrice: Decimal;
      migrationProgressBps: bigint;
    }>
  | Readonly<{
      kind: "action-decided";
      tickIndex: bigint;
      agentId: string;
      archetype: AgentArchetype;
      agentOrder: bigint;
      executionOrderIndex: bigint;
      action: SimulationAction;
    }>
  | Readonly<{
      kind: "trade-executed";
      tickIndex: bigint;
      agentId: string;
      archetype: AgentArchetype;
      agentOrder: bigint;
      executionOrderIndex: bigint;
      result: TradeResult;
    }>
  | Readonly<{
      kind: "action-rejected";
      tickIndex: bigint;
      agentId: string;
      archetype: AgentArchetype;
      agentOrder: bigint;
      executionOrderIndex: bigint;
      action: SimulationAction;
      message: string;
    }>
  | Readonly<{
      kind: "agent-failed";
      tickIndex: bigint;
      agentId: string;
      archetype: AgentArchetype;
      agentOrder: bigint;
      message: string;
    }>
  | Readonly<{
      kind: "tick-completed";
      tickIndex: bigint;
      clock: SimulationClock;
      spotPrice: Decimal;
      migrationProgressBps: bigint;
    }>;

export type StochasticSimulationTrace = Readonly<
  SeededRunMetadata & {
    id: string;
    kind: "stochastic-trace";
    status: "completed" | "partial";
    engineVersion: string;
    sdkVersion: string;
    requestedTicks: bigint;
    completedTicks: bigint;
    executionOrder: SimulationExecutionOrder;
    startedAtSeconds: bigint;
    completedAtSeconds: bigint;
    initialState: PoolState;
    finalState: PoolState;
    agentCounts: Readonly<Record<AgentArchetype, bigint>>;
    portfolios: readonly AgentPortfolioResult[];
    events: readonly StochasticSimulationEvent[];
  }
>;

export type StochasticSimulationInput = Readonly<{
  id: string;
  randomSeed: bigint;
  initialState: PoolState;
  agents: readonly SimulationAgent[];
  ticks: StochasticTickConfiguration;
}>;

const ARCHETYPES: readonly AgentArchetype[] = [
  "retail-buyer",
  "whale",
  "sniper",
  "momentum-trader",
  "profit-taker",
  "panic-seller",
  "random-trader",
];

export function runStochasticSimulationTrace(
  input: StochasticSimulationInput,
): StochasticSimulationTrace {
  validateInput(input);
  const random = createSeededRandom(input.randomSeed);
  const agentCounts = Object.fromEntries(ARCHETYPES.map((archetype) => [archetype, 0n])) as Record<
    AgentArchetype,
    bigint
  >;
  for (const agent of input.agents) agentCounts[agent.archetype] += 1n;

  const events: StochasticSimulationEvent[] = [];
  const cumulativeBaseBoughtAtomicByArchetype = Object.fromEntries(
    ARCHETYPES.map((archetype) => [archetype, 0n]),
  ) as Record<AgentArchetype, bigint>;
  const initialState = input.initialState;
  const portfolios = new Map(
    input.agents.map((agent) => [agent.id, createInitialPortfolio(agent, initialState)]),
  );
  let state = initialState;
  let completedTicks = 0n;
  let hadAgentFailure = false;

  for (let tickIndex = 0n; tickIndex < input.ticks.tickCount; tickIndex += 1n) {
    if (state.migrationProgress !== "bonding") break;

    const clock = {
      slot: initialState.clock.slot + input.ticks.slotsPerTick * (tickIndex + 1n),
      timestampSeconds:
        initialState.clock.timestampSeconds + input.ticks.secondsPerTick * (tickIndex + 1n),
    };
    state = { ...state, clock };
    const observation: SimulationObservation = {
      tickIndex,
      clock,
      state,
      spotPrice: getSpotPrice(state),
      migrationProgressBps: calculateMigrationQuoteAccounting(
        state.ledger.pool.quote.raw,
        state.curve.migrationQuoteThresholdAtomic,
      ).progressBps,
      cumulativeBaseBoughtAtomicByArchetype: { ...cumulativeBaseBoughtAtomicByArchetype },
    };
    for (const portfolio of portfolios.values()) {
      if (observation.spotPrice.greaterThan(portfolio.peakSpotPrice)) {
        portfolio.peakSpotPrice = observation.spotPrice;
      }
    }
    events.push({
      kind: "tick-observed",
      tickIndex,
      clock,
      spotPrice: observation.spotPrice,
      migrationProgressBps: observation.migrationProgressBps,
    });

    const decisions: Readonly<{
      agent: SimulationAgent;
      agentOrder: bigint;
      action: SimulationAction;
    }>[] = [];
    for (let index = 0; index < input.agents.length; index += 1) {
      const agent = input.agents[index];
      if (agent === undefined) continue;
      const agentOrder = BigInt(index);
      let action: SimulationAction;
      try {
        const portfolio = portfolios.get(agent.id);
        if (!portfolio) throw new RangeError("Agent portfolio state is missing");
        action = validateAction(
          agent.decide(
            { ...observation, portfolio: portfolioObservation(portfolio, state) },
            random,
          ),
        );
      } catch (error) {
        hadAgentFailure = true;
        events.push({
          kind: "agent-failed",
          tickIndex,
          agentId: agent.id,
          archetype: agent.archetype,
          agentOrder,
          message: errorMessage(error),
        });
        continue;
      }
      decisions.push({ agent, agentOrder, action });
    }

    const executionDecisions = [...decisions];
    if (input.ticks.executionOrder === "seeded-random") {
      for (let index = executionDecisions.length - 1; index > 0; index -= 1) {
        const swapIndex = Number(random.nextBelow(BigInt(index + 1)));
        const current = executionDecisions[index];
        const swap = executionDecisions[swapIndex];
        if (current !== undefined && swap !== undefined) {
          executionDecisions[index] = swap;
          executionDecisions[swapIndex] = current;
        }
      }
    }

    for (let index = 0; index < executionDecisions.length; index += 1) {
      const decision = executionDecisions[index];
      if (decision === undefined) continue;
      events.push({
        kind: "action-decided",
        tickIndex,
        agentId: decision.agent.id,
        archetype: decision.agent.archetype,
        agentOrder: decision.agentOrder,
        executionOrderIndex: BigInt(index),
        action: decision.action,
      });
    }

    for (let index = 0; index < executionDecisions.length; index += 1) {
      const decision = executionDecisions[index];
      if (decision === undefined) continue;
      const { agent, agentOrder, action } = decision;
      const executionOrderIndex = BigInt(index);
      if (action.kind === "wait") continue;
      try {
        const portfolio = portfolios.get(agent.id);
        if (!portfolio) throw new RangeError("Agent portfolio state is missing");
        if (action.inputAtomic > MAX_CURVE_U64) {
          throw new RangeError("Agent trade input must fit in an unsigned 64-bit amount");
        }
        if (action.kind === "buy" && action.inputAtomic > portfolio.quoteBalanceAtomic) {
          throw new RangeError("Agent quote balance is insufficient for this buy action");
        }
        if (action.kind === "sell" && action.inputAtomic > portfolio.baseBalanceAtomic) {
          throw new RangeError("Agent base balance is insufficient for this sell action");
        }
        const result =
          action.kind === "buy"
            ? quoteBuy(action.inputAtomic, state)
            : quoteSell(action.inputAtomic, state);
        state =
          action.kind === "buy"
            ? executeBuy(action.inputAtomic, state)
            : executeSell(action.inputAtomic, state);
        updatePortfolioAfterTrade(portfolio, result, tickIndex);
        if (result.direction === "buy") {
          cumulativeBaseBoughtAtomicByArchetype[agent.archetype] += result.output.amount.raw;
        }
        for (const otherPortfolio of portfolios.values()) {
          if (result.metrics.spotPriceAfter.greaterThan(otherPortfolio.peakSpotPrice)) {
            otherPortfolio.peakSpotPrice = result.metrics.spotPriceAfter;
          }
        }
        events.push({
          kind: "trade-executed",
          tickIndex,
          agentId: agent.id,
          archetype: agent.archetype,
          agentOrder,
          executionOrderIndex,
          result,
        });
      } catch (error) {
        events.push({
          kind: "action-rejected",
          tickIndex,
          agentId: agent.id,
          archetype: agent.archetype,
          agentOrder,
          executionOrderIndex,
          action,
          message: errorMessage(error),
        });
      }
    }

    completedTicks += 1n;
    const tickProgressBps = calculateMigrationQuoteAccounting(
      state.ledger.pool.quote.raw,
      state.curve.migrationQuoteThresholdAtomic,
    ).progressBps;
    events.push({
      kind: "tick-completed",
      tickIndex,
      clock,
      spotPrice: getSpotPrice(state),
      migrationProgressBps: tickProgressBps,
    });
  }

  return {
    ...createSeededRunMetadata(input.randomSeed),
    id: input.id,
    kind: "stochastic-trace",
    status: hadAgentFailure ? "partial" : "completed",
    engineVersion: DBC_SIMULATION_ENGINE_VERSION,
    sdkVersion: PINNED_SIMULATION_SDK_VERSION,
    requestedTicks: input.ticks.tickCount,
    completedTicks,
    executionOrder: input.ticks.executionOrder,
    startedAtSeconds: initialState.clock.timestampSeconds,
    completedAtSeconds: state.clock.timestampSeconds,
    initialState,
    finalState: state,
    agentCounts,
    portfolios: input.agents.map((agent) => {
      const portfolio = portfolios.get(agent.id);
      if (!portfolio) throw new RangeError("Agent portfolio state is missing");
      return {
        agentId: agent.id,
        archetype: agent.archetype,
        ...portfolioObservation(portfolio, state),
      };
    }),
    events,
  };
}

function validateInput(input: StochasticSimulationInput): void {
  if (input.id.trim().length === 0) throw new TypeError("Simulation run id must be non-empty");
  createSeededRunMetadata(input.randomSeed);
  if (
    typeof input.ticks.tickCount !== "bigint" ||
    typeof input.ticks.slotsPerTick !== "bigint" ||
    typeof input.ticks.secondsPerTick !== "bigint" ||
    (input.ticks.executionOrder !== "configured" &&
      input.ticks.executionOrder !== "seeded-random") ||
    input.ticks.tickCount <= 0n ||
    input.ticks.slotsPerTick <= 0n ||
    input.ticks.secondsPerTick <= 0n
  ) {
    throw new RangeError(
      "Tick count, slots per tick, and seconds per tick must be positive bigints",
    );
  }
  const stateValidation = validatePoolState(input.initialState);
  if (stateValidation.status === "invalid") {
    throw new RangeError(
      stateValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  const agentIds = new Set<string>();
  for (const agent of input.agents) {
    if (agent.id.trim().length === 0) throw new TypeError("Simulation agent id must be non-empty");
    if (agentIds.has(agent.id)) throw new TypeError(`Duplicate simulation agent id: ${agent.id}`);
    if (!ARCHETYPES.includes(agent.archetype)) {
      throw new TypeError(`Unsupported simulation archetype: ${String(agent.archetype)}`);
    }
    if (typeof agent.decide !== "function")
      throw new TypeError("Simulation agent requires decide()");
    for (const [label, amount] of [
      ["Initial quote balance", agent.initialQuoteBalanceAtomic],
      ["Initial base balance", agent.initialBaseBalanceAtomic],
      ["Initial base cost basis", agent.initialBaseCostBasisQuoteAtomic],
    ] as const) {
      if (typeof amount !== "bigint" || amount < 0n) {
        throw new RangeError(`${label} must be a non-negative atomic bigint`);
      }
      if (amount > MAX_CURVE_U64) {
        throw new RangeError(`${label} must fit in an unsigned 64-bit amount`);
      }
    }
    agentIds.add(agent.id);
  }
  const initialAgentBase = input.agents.reduce(
    (total, agent) => total + agent.initialBaseBalanceAtomic,
    0n,
  );
  if (initialAgentBase > stateValidation.value.supply.baseDistributed.amount.raw) {
    throw new RangeError("Initial agent base balances exceed the pool's distributed base supply");
  }
}

function validateAction(action: SimulationAction): SimulationAction {
  if (action === null || typeof action !== "object") {
    throw new TypeError("Agent decision must be a wait, buy, or sell action");
  }
  if (action.kind === "wait") return action;
  if (
    (action.kind !== "buy" && action.kind !== "sell") ||
    typeof action.inputAtomic !== "bigint" ||
    action.inputAtomic <= 0n
  ) {
    throw new TypeError("Trade actions require buy or sell and a positive atomic bigint input");
  }
  return action;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInitialPortfolio(agent: SimulationAgent, state: PoolState): MutableAgentPortfolio {
  return {
    quoteBalanceAtomic: agent.initialQuoteBalanceAtomic,
    baseBalanceAtomic: agent.initialBaseBalanceAtomic,
    baseCostBasisQuoteAtomic: agent.initialBaseCostBasisQuoteAtomic,
    successfulBuyCount: 0n,
    successfulSellCount: 0n,
    peakSpotPrice: getSpotPrice(state),
  };
}

function portfolioObservation(
  portfolio: MutableAgentPortfolio,
  state: PoolState,
): AgentPortfolioObservation {
  const averageEntryPrice =
    portfolio.baseBalanceAtomic === 0n
      ? undefined
      : new ExactDecimal(portfolio.baseCostBasisQuoteAtomic.toString())
          .mul(new ExactDecimal(10).pow(state.curve.baseDecimals))
          .div(
            new ExactDecimal(portfolio.baseBalanceAtomic.toString()).mul(
              new ExactDecimal(10).pow(state.curve.quoteDecimals),
            ),
          );
  return {
    quoteBalanceAtomic: portfolio.quoteBalanceAtomic,
    baseBalanceAtomic: portfolio.baseBalanceAtomic,
    baseCostBasisQuoteAtomic: portfolio.baseCostBasisQuoteAtomic,
    successfulBuyCount: portfolio.successfulBuyCount,
    successfulSellCount: portfolio.successfulSellCount,
    ...(portfolio.firstBuyTickIndex === undefined
      ? {}
      : { firstBuyTickIndex: portfolio.firstBuyTickIndex }),
    ...(averageEntryPrice === undefined ? {} : { averageEntryPrice }),
    peakSpotPrice: portfolio.peakSpotPrice,
  };
}

function updatePortfolioAfterTrade(
  portfolio: MutableAgentPortfolio,
  result: TradeResult,
  tickIndex: bigint,
): void {
  if (result.direction === "buy") {
    portfolio.quoteBalanceAtomic -= result.consumedInput.amount.raw;
    portfolio.baseBalanceAtomic += result.output.amount.raw;
    portfolio.baseCostBasisQuoteAtomic += result.consumedInput.amount.raw;
    if (result.consumedInput.amount.raw > 0n) {
      portfolio.successfulBuyCount += 1n;
      portfolio.firstBuyTickIndex ??= tickIndex;
    }
    return;
  }

  const baseBefore = portfolio.baseBalanceAtomic;
  const baseSold = result.consumedInput.amount.raw;
  const costReduction =
    baseSold === baseBefore
      ? portfolio.baseCostBasisQuoteAtomic
      : (portfolio.baseCostBasisQuoteAtomic * baseSold) / baseBefore;
  portfolio.baseBalanceAtomic -= baseSold;
  portfolio.baseCostBasisQuoteAtomic -= costReduction;
  portfolio.quoteBalanceAtomic += result.output.amount.raw;
  portfolio.successfulSellCount += 1n;
}
