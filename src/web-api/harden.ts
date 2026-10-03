import { Decimal } from "decimal.js";
import {
  convertAttackBigints,
  executeAttack,
  parseScenarioConfiguration,
  validateAgentDistribution,
} from "../cli/attack.js";
import { parseCurrencyAmount } from "../domain/currency-amount.js";
import { generateHardenedCandidate } from "../domain/harden-market-candidate.js";
import {
  compareHardenedCandidate,
  type HardeningComparisonValue,
} from "../domain/harden-market-comparison.js";
import {
  type HardeningAttackReplayConfiguration,
  type HardeningReplayConfiguration,
  resimulateHardenedCandidate,
} from "../domain/harden-market-resimulation.js";
import { createMvpAgentPopulation } from "../domain/simulation-scenario.js";
import { executeBuy, quoteBuy, runDeterministicSimulation } from "../domain/simulator.js";
import { createInitialPoolState } from "../domain/solver-deterministic-verification.js";
import { presentAdvanced } from "./advanced.js";
import { jsonSnapshot } from "./attack.js";
import { prepareWebAudit } from "./audit.js";
import type { WebAuditRequest, WebHardeningResponse } from "./contracts.js";
import { isRecord } from "./review.js";

export function hardenWebDocument(input: unknown): WebHardeningResponse {
  try {
    if (
      !isRecord(input) ||
      Object.keys(input).some(
        (key) => !["auditRequest", "findingIds", "riskWeights", "stochasticReplay"].includes(key),
      ) ||
      !Array.isArray(input.findingIds) ||
      input.findingIds.length === 0 ||
      input.findingIds.length > 30 ||
      input.findingIds.some((id) => typeof id !== "string") ||
      !isRecord(input.riskWeights)
    )
      throw new TypeError(
        "Select audit finding IDs, explicit risk weights, and a stochastic replay configuration.",
      );
    const prepared = prepareWebAudit(input.auditRequest);
    if (new Set(input.findingIds).size !== input.findingIds.length)
      throw new RangeError("Duplicate selected finding.");
    const selectedFindings = input.findingIds.map((id) => {
      const finding = prepared.findings.find((finding) => finding.id === id);
      if (!finding) throw new RangeError("Unknown finding for the recomputed audit.");
      return finding;
    });
    const weights: Partial<Record<"earlyPriceImpact" | "attackProfitability", Decimal>> = {};
    for (const [key, value] of Object.entries(input.riskWeights)) {
      if (
        (key !== "earlyPriceImpact" && key !== "attackProfitability") ||
        typeof value !== "string" ||
        value.length > 64 ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      )
        throw new TypeError(
          "Risk weights must be plain decimal strings for earlyPriceImpact or attackProfitability.",
        );
      weights[key] = new Decimal(value);
    }
    const stochastic = parseStochasticReplay(input.stochasticReplay);
    if (prepared.requests.some((request) => request.warmupQuoteAtomic !== undefined))
      throw new RangeError(
        "Paired replay currently requires attack runs from the configured initial state (no warm-up). Clear attack warm-ups and rerun before hardening.",
      );
    if (!prepared.script)
      throw new RangeError(
        "Retain a valid deterministic script before hardening; its exact actions are required for paired replay.",
      );
    const scriptInputs = (input.auditRequest as WebAuditRequest).trades;
    if (!scriptInputs) throw new RangeError("No retained deterministic inputs.");
    const trades = scriptInputs.map((trade) => ({
      direction: trade.direction,
      inputAtomic: parseCurrencyAmount(
        trade.amount,
        trade.direction === "buy" ? prepared.market.quoteDecimals : prepared.market.baseDecimals,
      ).raw,
      clock: { slot: BigInt(trade.slot), timestampSeconds: BigInt(trade.timestampSeconds) },
    }));
    if (prepared.requests.length === 0)
      throw new RangeError("Retain at least one attack before hardening.");
    const openingRequest = prepared.requests.find(
      (request) => request.scenario === "opening-sniper",
    );
    const options = {
      ...prepared.options,
      earlyPriceImpactEvaluator: ({
        candidateId,
        curve,
        probeQuoteAtomic,
      }: Parameters<NonNullable<typeof prepared.options.earlyPriceImpactEvaluator>>[0]) => {
        const quote = runDeterministicSimulation({
          id: `web-probe-${candidateId}`,
          initialState: createInitialPoolState(prepared.market, curve, prepared.options.simulation),
          trades: [
            {
              direction: "buy",
              inputAtomic: probeQuoteAtomic,
              ...(trades[0]?.clock ? { clock: trades[0].clock } : {}),
            },
          ],
        }).trades[0];
        if (!quote) throw new RangeError("No early-impact probe executed.");
        return {
          priceImpactBps: quote.metrics.priceImpactBps,
          evidenceId: `web-probe-${candidateId}`,
        };
      },
      ...(openingRequest
        ? {
            attackExposureEvaluator: ({
              candidateId,
              curve,
            }: Parameters<NonNullable<typeof prepared.options.attackExposureEvaluator>>[0]) => {
              let state = createInitialPoolState(
                prepared.market,
                curve,
                prepared.options.simulation,
              );
              if (openingRequest.warmupQuoteAtomic) {
                const amount = BigInt(openingRequest.warmupQuoteAtomic);
                const quote = quoteBuy(amount, state);
                if (quote.status !== "filled")
                  throw new RangeError(
                    "Opening attack warm-up must fill exactly on each candidate.",
                  );
                state = executeBuy(amount, state);
              }
              const configuration = parseScenarioConfiguration(
                "opening-sniper",
                openingRequest.configuration as Record<string, unknown>,
              );
              const result = executeAttack(
                "opening-sniper",
                { ...configuration, id: `web-objective-${candidateId}` },
                state,
              );
              if (result.status === "failed" || result.scenario !== "opening-sniper")
                throw new RangeError(
                  "No comparable completed opening-sniper metric for this candidate.",
                );
              const attacker = configuration.attacker as Record<string, bigint>;
              return {
                attackerProfitQuoteAtomic: result.metrics.attackerPnlQuote.p95.amount.raw,
                attackerCapitalQuoteAtomic: attacker.initialQuoteBalanceAtomic as bigint,
                evidenceId: result.id,
              };
            },
          }
        : {}),
    };
    const generation = generateHardenedCandidate({
      originalMarket: prepared.market,
      originalCandidate: prepared.candidate,
      originalSolverOptions: options,
      selectedFindings,
      addedRiskWeights: weights,
    });
    const notices = [
      ...generation.issues.map((issue) => issue.message),
      ...generation.conversion.unsupportedFindings.map((finding) => finding.reason),
      ...generation.conversion.unsupportedRiskTerms.map((term) => term.reason),
    ];
    if (!generation.hardenedCandidate)
      return {
        status: "unsatisfied",
        message:
          "No hardened draft preserves the original intent under the selected numeric objectives.",
        notices,
        snapshot: jsonSnapshot({ schemaVersion: 1, request: input, generation }),
        metrics: [],
      };
    const replays: HardeningAttackReplayConfiguration[] = prepared.requests.map(
      (request) =>
        ({
          scenario: request.scenario,
          id: `paired-${request.scenario}`,
          configuration: parseScenarioConfiguration(
            request.scenario,
            request.configuration as Record<string, unknown>,
          ),
        }) as HardeningAttackReplayConfiguration,
    );
    const configuration: HardeningReplayConfiguration = {
      deterministic: { id: "web-paired-script", trades },
      stochastic,
      attacks: replays,
    };
    const resimulation = resimulateHardenedCandidate(generation, configuration);
    const comparison = compareHardenedCandidate(generation, resimulation);
    return {
      status: comparison.status,
      message:
        "Paired modeled comparison. Original intent and settings retained; improvement is measured, not guaranteed. Both drafts remain unverified and non-deployable.",
      notices,
      originalCandidateId: comparison.originalCandidateId,
      hardenedCandidateId: comparison.hardenedCandidateId,
      advanced: presentAdvanced(
        generation.hardenedCandidate.id,
        generation.hardenedCandidate.curve,
        prepared.market,
        {
          objectiveWeights: generation.conversion.objectiveWeights,
          simulation: prepared.options.simulation,
          ...(prepared.options.earlyPriceImpactProbeQuoteAtomic === undefined
            ? {}
            : {
                earlyPriceImpactProbeQuoteAtomic: prepared.options.earlyPriceImpactProbeQuoteAtomic,
              }),
        },
      ),
      metrics: comparison.metrics.map((metric) => ({
        id: metric.id,
        label: metric.label,
        unit: metric.unit,
        direction: metric.direction,
        status: metric.status,
        baseline: presentValue(metric.baseline),
        hardened: presentValue(metric.hardened),
        delta: metric.delta?.toString() ?? null,
        improved: metric.improved ?? null,
        references: metric.evidenceReferences,
        reason: metric.reason ?? "",
      })),
      snapshot: jsonSnapshot({
        schemaVersion: 1,
        request: input,
        auditPolicy: prepared.policy,
        comparison,
      }),
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "Hardening failed; no comparison available.",
      notices: [],
      metrics: [],
    };
  }
}

function presentValue(value: HardeningComparisonValue | undefined): string | null {
  if (!value) return null;
  return value.kind === "amount" ? value.raw.toString() : value.value.toString();
}

export function parseStochasticReplay(input: unknown): HardeningReplayConfiguration["stochastic"] {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (key) =>
        !["id", "randomSeed", "requestedIterations", "agentDistribution", "ticks"].includes(key),
    ) ||
    !isRecord(input.ticks) ||
    Object.keys(input.ticks).some(
      (key) => !["tickCount", "slotsPerTick", "secondsPerTick", "executionOrder"].includes(key),
    )
  )
    throw new TypeError(
      "Provide explicit stochastic replay identity, seed, iterations, population, and tick configuration.",
    );
  const converted = convertAttackBigints(
    input,
    "$.stochasticReplay",
  ) as HardeningReplayConfiguration["stochastic"];
  validateAgentDistribution(converted.agentDistribution, "stochasticReplay.agentDistribution");
  const agents = createMvpAgentPopulation(converted.agentDistribution).agents.length;
  if (
    typeof converted.id !== "string" ||
    converted.id.length === 0 ||
    converted.id.length > 256 ||
    typeof converted.randomSeed !== "bigint" ||
    typeof converted.requestedIterations !== "bigint" ||
    converted.requestedIterations <= 0n ||
    converted.requestedIterations > 10n ||
    typeof converted.ticks.tickCount !== "bigint" ||
    converted.ticks.tickCount <= 0n ||
    converted.ticks.tickCount > 100n ||
    agents > 100 ||
    converted.requestedIterations * converted.ticks.tickCount * BigInt(agents) > 2_000n ||
    typeof converted.ticks.slotsPerTick !== "bigint" ||
    converted.ticks.slotsPerTick <= 0n ||
    typeof converted.ticks.secondsPerTick !== "bigint" ||
    converted.ticks.secondsPerTick <= 0n ||
    !["configured", "seeded-random"].includes(converted.ticks.executionOrder)
  )
    throw new RangeError(
      "Invalid stochastic replay or exceeded local budget (10 iterations, 100 ticks/agents, 2,000 agent-ticks). Use explicit clock increments and execution order.",
    );
  return converted;
}
