import type { AttackResult } from "../domain/attack-result.js";
import { runFeeScheduleTimingAttack } from "../domain/attacks/fee-schedule-timing.js";
import { runOpeningSniperAttack } from "../domain/attacks/opening-sniper.js";
import { runPumpAndDumpAttack } from "../domain/attacks/pump-and-dump.js";
import { runSellCascadeAttack } from "../domain/attacks/sell-cascade.js";
import { runWhaleEntryAttack } from "../domain/attacks/whale-entry.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import type { PoolState } from "../domain/pool-state.js";
import { executeBuy, quoteBuy } from "../domain/simulator.js";
import {
  validateSolverSimulationConfiguration,
  verifyCandidateWithDeterministicSimulator,
} from "../domain/solver-deterministic-verification.js";
import { compileDocument } from "./compile.js";
import { convertConfigBigintStrings } from "./validate.js";

const ARCHETYPES = [
  "retail-buyer",
  "whale",
  "sniper",
  "momentum-trader",
  "profit-taker",
  "panic-seller",
  "random-trader",
] as const;

const AGENT_TEMPLATE_FIELDS: Readonly<Record<(typeof ARCHETYPES)[number], readonly string[]>> = {
  "retail-buyer": [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "minimumBuyQuoteAtomic",
    "maximumBuyQuoteAtomic",
    "buyProbabilityBps",
    "sellProbabilityBps",
    "sellShareBps",
  ],
  whale: [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "entryTickIndex",
    "buyQuoteAtomic",
  ],
  sniper: [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "buyQuoteAtomic",
    "holdTicks",
    "minimumOtherBuyerBaseAtomic",
    "exitShareBps",
  ],
  "momentum-trader": [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "priceIncreaseThresholdBps",
    "buyQuoteAtomic",
    "maximumPurchases",
  ],
  "profit-taker": [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "entryTickIndex",
    "buyQuoteAtomic",
    "targetGainBps",
    "sellShareBps",
  ],
  "panic-seller": [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "entryTickIndex",
    "buyQuoteAtomic",
    "drawdownThresholdBps",
    "sellShareBps",
  ],
  "random-trader": [
    "id",
    "archetype",
    "initialQuoteBalanceAtomic",
    "initialBaseBalanceAtomic",
    "initialBaseCostBasisQuoteAtomic",
    "buyProbabilityBps",
    "sellProbabilityBps",
    "minimumBuyQuoteAtomic",
    "maximumBuyQuoteAtomic",
    "sellShareBps",
  ],
};

const BIGINT_FIELDS = new Set([
  "randomSeed",
  "requestedIterations",
  "tickCount",
  "slotsPerTick",
  "secondsPerTick",
  "initialQuoteBalanceAtomic",
  "initialBaseBalanceAtomic",
  "initialBaseCostBasisQuoteAtomic",
  "minimumBuyQuoteAtomic",
  "maximumBuyQuoteAtomic",
  "buyProbabilityBps",
  "sellProbabilityBps",
  "sellShareBps",
  "entryTickIndex",
  "buyQuoteAtomic",
  "holdTicks",
  "minimumOtherBuyerBaseAtomic",
  "exitShareBps",
  "priceIncreaseThresholdBps",
  "maximumPurchases",
  "targetGainBps",
  "drawdownThresholdBps",
  "migrationQuoteShareBps",
  "minimumMomentumBaseAtomic",
]);

export type CliAttackScenario =
  | "opening-sniper"
  | "whale-entry"
  | "pump-and-dump"
  | "sell-cascade"
  | "fee-schedule-timing";

export type CliAttackDocument = Readonly<{
  schemaVersion: 1;
  command: "attack";
  status: "blocked" | "completed" | "partial" | "failed";
  scenario: CliAttackScenario;
  candidate?: Readonly<{
    id: string;
    kind: "curve-draft";
    verificationStatus: "unverified";
    sdkVersion: string;
  }>;
  evidence: Readonly<{
    classification: "modeled";
    note: string;
  }>;
  assumptions: unknown;
  result?: AttackResult;
  failure?: Readonly<{ code: string; message: string }>;
}>;

export function runAttackDocument(
  input: unknown,
  requestedScenario: string,
  candidateId?: string,
): CliAttackDocument {
  const scenario = normalizeScenario(requestedScenario);
  const request = requireRecord(input, "Attack request");
  assertAllowedKeys(
    request,
    [
      "schemaVersion",
      "marketIntent",
      "objectiveWeights",
      "simulation",
      "earlyPriceImpactProbeQuoteAtomic",
      "preScenarioBuyQuoteAtomic",
      "attacks",
    ],
    "Attack request",
  );
  if (request.schemaVersion !== 1) throw new TypeError("Attack request schemaVersion must be 1");
  const attackConfigurations = requireRecord(request.attacks, "attacks");
  assertAllowedKeys(
    attackConfigurations,
    ["opening-sniper", "whale-entry", "pump-and-dump", "sell-cascade", "fee-schedule-timing"],
    "attacks",
  );
  const configKey = scenario;
  const rawScenarioConfiguration = requireRecord(
    attackConfigurations[configKey],
    `attacks.${configKey}`,
  );
  const scenarioConfiguration = parseScenarioConfiguration(scenario, rawScenarioConfiguration);
  const preScenarioBuyQuoteAtomic =
    request.preScenarioBuyQuoteAtomic === undefined
      ? undefined
      : parseUnsignedInteger(request.preScenarioBuyQuoteAtomic, "preScenarioBuyQuoteAtomic");
  if (preScenarioBuyQuoteAtomic === 0n) {
    throw new RangeError("preScenarioBuyQuoteAtomic must be positive when supplied");
  }
  const assumptions = {
    marketIntent: request.marketIntent,
    objectiveWeights: request.objectiveWeights,
    simulation: request.simulation,
    attack: scenarioConfiguration,
    ...(request.preScenarioBuyQuoteAtomic === undefined
      ? {}
      : { preScenarioBuyQuoteAtomic: request.preScenarioBuyQuoteAtomic }),
    ...(request.earlyPriceImpactProbeQuoteAtomic === undefined
      ? {}
      : { earlyPriceImpactProbeQuoteAtomic: request.earlyPriceImpactProbeQuoteAtomic }),
  };
  const compileInput = {
    marketIntent: request.marketIntent,
    objectiveWeights: request.objectiveWeights,
    simulation: request.simulation,
    ...(request.earlyPriceImpactProbeQuoteAtomic === undefined
      ? {}
      : { earlyPriceImpactProbeQuoteAtomic: request.earlyPriceImpactProbeQuoteAtomic }),
  };
  const compilation = compileDocument(compileInput);
  const candidate =
    candidateId === undefined
      ? compilation.draftCandidates[0]
      : compilation.draftCandidates.find(({ id }) => id === candidateId);
  if (candidateId !== undefined && !candidate)
    throw new RangeError(
      "Unknown candidate for this exact compile request. Recompile and select a draft.",
    );
  if (!candidate) {
    return {
      schemaVersion: 1,
      command: "attack",
      status: "blocked",
      scenario,
      evidence: {
        classification: "modeled",
        note: "No solver-generated curve draft was available; no attack simulation was run.",
      },
      assumptions,
      failure: compilation.failure,
    };
  }

  const marketResult = validateMarketIntent(request.marketIntent);
  if (marketResult.status !== "valid") {
    throw new RangeError("Attack market intent did not pass validation");
  }
  const convertedSimulation = convertConfigBigintStrings(request.simulation, "$.simulation");
  const simulationConfiguration = validateSolverSimulationConfiguration(convertedSimulation);
  if (simulationConfiguration.status !== "valid") {
    throw new RangeError(simulationConfiguration.issues.map(({ message }) => message).join("; "));
  }
  const verification = verifyCandidateWithDeterministicSimulator({
    candidateId: candidate.id,
    market: marketResult.normalized,
    curve: candidate.curve,
    configuration: simulationConfiguration.value,
  });
  if (verification.status !== "verified") {
    return {
      schemaVersion: 1,
      command: "attack",
      status: "blocked",
      scenario,
      candidate: {
        id: candidate.id,
        kind: "curve-draft",
        verificationStatus: "unverified",
        sdkVersion: candidate.sdkCurveValidation.sdkVersion,
      },
      evidence: {
        classification: "modeled",
        note: "Deterministic candidate replay failed; no attack simulation was run.",
      },
      assumptions,
      failure: {
        code: "candidate_initialization_failed",
        message: verification.issues.map(({ message }) => message).join("; "),
      },
    };
  }

  let initialState = verification.simulation.initialState;
  if (preScenarioBuyQuoteAtomic !== undefined) {
    const warmup = quoteBuy(preScenarioBuyQuoteAtomic, initialState);
    if (
      warmup.status !== "filled" ||
      warmup.consumedInput.amount.raw !== preScenarioBuyQuoteAtomic
    ) {
      throw new RangeError("preScenarioBuyQuoteAtomic did not fill exactly on the candidate curve");
    }
    initialState = executeBuy(preScenarioBuyQuoteAtomic, initialState);
  }
  const attackResult = executeAttack(scenario, scenarioConfiguration, initialState);
  return {
    schemaVersion: 1,
    command: "attack",
    status: attackResult.status,
    scenario,
    candidate: {
      id: candidate.id,
      kind: "curve-draft",
      verificationStatus: "unverified",
      sdkVersion: candidate.sdkCurveValidation.sdkVersion,
    },
    evidence: {
      classification: "modeled",
      note: "Attack ran against a solver-generated curve draft. Full DBC configuration and token-supply validation are pending; this is not a deployable candidate or a prediction of user behavior.",
    },
    assumptions,
    result: attackResult,
    ...(attackResult.status === "failed" ? { failure: attackResult.failure } : {}),
  };
}

export function formatAttackDocument(document: CliAttackDocument): string {
  const lines = [
    `Attack ${document.scenario}: ${document.status.toUpperCase()}`,
    `Candidate: ${document.candidate ? `${document.candidate.id} (curve draft; full verification pending)` : "not available"}`,
    `Evidence: ${document.evidence.note}`,
    "Assumptions:",
    JSON.stringify(document.assumptions, bigintReplacer, 2),
  ];
  if (document.result) {
    lines.push("Observed modeled result:", JSON.stringify(document.result, bigintReplacer, 2));
  }
  if (document.failure) lines.push(`Failure: ${document.failure.message}`);
  return lines.join("\n");
}

export function executeAttack(
  scenario: CliAttackScenario,
  configuration: Record<string, unknown>,
  initialState: PoolState,
): AttackResult {
  switch (scenario) {
    case "opening-sniper":
      return runOpeningSniperAttack({ ...configuration, initialState } as Parameters<
        typeof runOpeningSniperAttack
      >[0]);
    case "whale-entry":
      return runWhaleEntryAttack({ ...configuration, initialState } as Parameters<
        typeof runWhaleEntryAttack
      >[0]);
    case "pump-and-dump":
      return runPumpAndDumpAttack({ ...configuration, initialState } as Parameters<
        typeof runPumpAndDumpAttack
      >[0]);
    case "sell-cascade":
      return runSellCascadeAttack({ ...configuration, initialState } as Parameters<
        typeof runSellCascadeAttack
      >[0]);
    case "fee-schedule-timing":
      return runFeeScheduleTimingAttack({ ...configuration, initialState } as Parameters<
        typeof runFeeScheduleTimingAttack
      >[0]);
  }
}

export function parseScenarioConfiguration(
  scenario: CliAttackScenario,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const attackAllowedFields: Readonly<Record<CliAttackScenario, readonly string[]>> = {
    "opening-sniper": [
      "id",
      "randomSeed",
      "requestedIterations",
      "supportingAgentDistribution",
      "attacker",
      "ticks",
    ],
    "whale-entry": [
      "id",
      "randomSeed",
      "requestedIterations",
      "supportingAgentDistribution",
      "attacker",
      "ticks",
    ],
    "pump-and-dump": [
      "id",
      "randomSeed",
      "requestedIterations",
      "supportingAgentDistribution",
      "attacker",
      "ticks",
    ],
    "sell-cascade": [
      "id",
      "randomSeed",
      "requestedIterations",
      "cascadeAgentDistribution",
      "backgroundAgentDistribution",
      "ticks",
    ],
    "fee-schedule-timing": ["id", "buyQuoteAtomic"],
  };
  assertAllowedKeys(input, attackAllowedFields[scenario], `attacks.${scenario}`);
  const converted = convertAttackBigints(input, `attacks.${scenario}`);
  if (!isRecord(converted)) throw new TypeError(`attacks.${scenario} must be an object`);
  if (scenario !== "fee-schedule-timing" && scenario !== "sell-cascade") {
    const attackerFields: Readonly<
      Record<Exclude<CliAttackScenario, "sell-cascade" | "fee-schedule-timing">, readonly string[]>
    > = {
      "opening-sniper": [
        "id",
        "initialQuoteBalanceAtomic",
        "buyQuoteAtomic",
        "holdTicks",
        "minimumOtherBuyerBaseAtomic",
        "exitShareBps",
      ],
      "whale-entry": [
        "id",
        "initialQuoteBalanceAtomic",
        "migrationQuoteShareBps",
        "entryTickIndex",
      ],
      "pump-and-dump": [
        "id",
        "initialQuoteBalanceAtomic",
        "buyQuoteAtomic",
        "entryTickIndex",
        "holdTicks",
        "minimumMomentumBaseAtomic",
        "exitShareBps",
      ],
    };
    assertAllowedKeys(
      requireRecord(converted.attacker, `attacks.${scenario}.attacker`),
      attackerFields[scenario],
      `attacks.${scenario}.attacker`,
    );
  }
  if (scenario !== "fee-schedule-timing") {
    assertAllowedKeys(
      requireRecord(converted.ticks, `attacks.${scenario}.ticks`),
      ["tickCount", "slotsPerTick", "secondsPerTick"],
      `attacks.${scenario}.ticks`,
    );
  }
  if (scenario === "sell-cascade") {
    validateAgentDistribution(converted.cascadeAgentDistribution, "cascadeAgentDistribution");
    validateAgentDistribution(converted.backgroundAgentDistribution, "backgroundAgentDistribution");
  } else if (scenario !== "fee-schedule-timing") {
    validateAgentDistribution(converted.supportingAgentDistribution, "supportingAgentDistribution");
  }
  return converted;
}

export function validateAgentDistribution(value: unknown, label: string): void {
  const distribution = requireRecord(value, label);
  assertAllowedKeys(distribution, ["counts", "templates"], label);
  const counts = requireRecord(distribution.counts, `${label}.counts`);
  for (const archetype of Object.keys(counts)) {
    if (!ARCHETYPES.includes(archetype as (typeof ARCHETYPES)[number])) {
      throw new TypeError(`${label}.counts contains unsupported archetype ${archetype}`);
    }
    if (typeof counts[archetype] !== "bigint") {
      throw new TypeError(`${label}.counts.${archetype} must be an integer string`);
    }
  }
  for (const archetype of ARCHETYPES) {
    if (typeof counts[archetype] !== "bigint") {
      throw new TypeError(
        `${label}.counts.${archetype} must be explicitly supplied as an integer string`,
      );
    }
  }
  const templates = requireRecord(distribution.templates, `${label}.templates`);
  for (const [archetype, templateValue] of Object.entries(templates)) {
    if (!ARCHETYPES.includes(archetype as (typeof ARCHETYPES)[number])) {
      throw new TypeError(`${label}.templates contains unsupported archetype ${archetype}`);
    }
    const template = requireRecord(templateValue, `${label}.templates.${archetype}`);
    const fields = AGENT_TEMPLATE_FIELDS[archetype as (typeof ARCHETYPES)[number]];
    assertAllowedKeys(template, fields, `${label}.templates.${archetype}`);
  }
}

export function convertAttackBigints(value: unknown, path: string, key?: string): unknown {
  if (key === "counts") {
    const counts = requireRecord(value, path);
    return Object.fromEntries(
      Object.entries(counts).map(([archetype, count]) => [
        archetype,
        parseUnsignedInteger(count, `${path}.${archetype}`),
      ]),
    );
  }
  if (key !== undefined && BIGINT_FIELDS.has(key)) return parseUnsignedInteger(value, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => convertAttackBigints(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      convertAttackBigints(childValue, `${path}.${childKey}`, childKey),
    ]),
  );
}

function parseUnsignedInteger(value: unknown, path: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${path} must be an unsigned integer decimal string`);
  }
  return BigInt(value);
}

function normalizeScenario(value: string): CliAttackScenario {
  const aliases: Readonly<Record<string, CliAttackScenario>> = {
    sniper: "opening-sniper",
    "opening-sniper": "opening-sniper",
    whale: "whale-entry",
    "whale-entry": "whale-entry",
    "pump-and-dump": "pump-and-dump",
    "sell-cascade": "sell-cascade",
    "fee-schedule-timing": "fee-schedule-timing",
  };
  const scenario = aliases[value];
  if (!scenario) throw new TypeError(`Unsupported attack scenario: ${value}`);
  return scenario;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains unsupported field ${unknown}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
