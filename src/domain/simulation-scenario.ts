import type { AgentArchetype, AgentCounts } from "./simulation.js";
import type { PoolState } from "./pool-state.js";
import { createMvpAgent } from "./simulation-agents.js";
import type { MvpAgentConfigurationMap } from "./simulation-agents.js";
import type { SimulationAgent } from "./stochastic-simulation.js";
import type {
  StochasticSimulationInput,
  StochasticTickConfiguration,
} from "./stochastic-simulation.js";

export const MAX_MVP_AGENT_POPULATION = 10_000n;

export type AgentDistributionConfiguration = Readonly<{
  counts: AgentCounts;
  templates: Readonly<Partial<MvpAgentConfigurationMap>>;
}>;

export type StochasticScenarioConfiguration = Readonly<{
  id: string;
  randomSeed: bigint;
  initialState: PoolState;
  agentDistribution: AgentDistributionConfiguration;
  ticks: StochasticTickConfiguration;
}>;

export type AgentPopulation = Readonly<{
  agents: readonly SimulationAgent[];
  agentCounts: AgentCounts;
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

export function createMvpAgentPopulation(
  configuration: AgentDistributionConfiguration,
): AgentPopulation {
  validateDistribution(configuration);
  const totalAgents = ARCHETYPES.reduce(
    (total, archetype) => total + configuration.counts[archetype],
    0n,
  );
  if (totalAgents > MAX_MVP_AGENT_POPULATION) {
    throw new RangeError(`Agent population exceeds the MVP limit of ${MAX_MVP_AGENT_POPULATION}`);
  }

  const agents: SimulationAgent[] = [];
  const agentCounts = Object.fromEntries(
    ARCHETYPES.map((archetype) => [archetype, configuration.counts[archetype]]),
  ) as Record<AgentArchetype, bigint>;
  const ids = new Set<string>();

  for (const archetype of ARCHETYPES) {
    const count = agentCounts[archetype];
    const template = configuration.templates[archetype];
    if (count === 0n) continue;
    if (template === undefined) {
      throw new TypeError(`Agent template is required when ${archetype} count is positive`);
    }
    if (template.archetype !== archetype) {
      throw new TypeError(`Agent template archetype does not match ${archetype}`);
    }
    for (let index = 0n; index < count; index += 1n) {
      const agent = createMvpAgent({
        ...template,
        id: `${template.id}-${index}`,
      } as MvpAgentConfigurationMap[typeof archetype]);
      if (ids.has(agent.id)) throw new TypeError(`Duplicate generated agent id: ${agent.id}`);
      ids.add(agent.id);
      agents.push(agent);
    }
  }

  return { agents, agentCounts };
}

export function createStochasticSimulationInput(
  configuration: StochasticScenarioConfiguration,
): StochasticSimulationInput {
  const population = createMvpAgentPopulation(configuration.agentDistribution);
  return {
    id: configuration.id,
    randomSeed: configuration.randomSeed,
    initialState: configuration.initialState,
    agents: population.agents,
    ticks: configuration.ticks,
  };
}

function validateDistribution(configuration: AgentDistributionConfiguration): void {
  const countKeys = Object.keys(configuration.counts);
  for (const archetype of countKeys) {
    if (!ARCHETYPES.includes(archetype as AgentArchetype)) {
      throw new TypeError(`Unsupported agent-distribution archetype: ${archetype}`);
    }
  }
  for (const archetype of ARCHETYPES) {
    const count = configuration.counts[archetype];
    if (typeof count !== "bigint" || count < 0n) {
      throw new RangeError(`${archetype} count must be a non-negative bigint`);
    }
  }
  for (const [archetype, template] of Object.entries(configuration.templates)) {
    if (!ARCHETYPES.includes(archetype as AgentArchetype)) {
      throw new TypeError(`Unsupported agent template: ${archetype}`);
    }
    if (!template || template.archetype !== archetype) {
      throw new TypeError(`Agent template archetype does not match ${archetype}`);
    }
  }
}
