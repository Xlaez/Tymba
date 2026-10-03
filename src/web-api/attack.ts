import {
  type CliAttackDocument,
  type CliAttackScenario,
  parseScenarioConfiguration,
  runAttackDocument,
} from "../cli/attack.js";
import { compileDocument } from "../cli/compile.js";
import { serializeCliJson } from "../cli/output.js";
import type { AttackResult } from "../domain/attack-result.js";
import { formatCurrencyAmount } from "../domain/currency-amount.js";
import type { JsonValue, WebAttackRequest, WebAttackResponse } from "./contracts.js";
import { isRecord } from "./review.js";

export const WEB_ATTACK_SCENARIOS = [
  "opening-sniper",
  "whale-entry",
  "pump-and-dump",
  "sell-cascade",
  "fee-schedule-timing",
] as const;

export function parseWebAttack(input: unknown): WebAttackRequest {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "compileRequest",
          "candidateId",
          "scenario",
          "configuration",
          "warmupQuoteAtomic",
        ].includes(key),
    ) ||
    !isRecord(input.compileRequest) ||
    typeof input.candidateId !== "string" ||
    input.candidateId.length > 256 ||
    !WEB_ATTACK_SCENARIOS.includes(input.scenario as CliAttackScenario) ||
    !isRecord(input.configuration)
  )
    throw new TypeError(
      "Provide a compile request, selected candidate, supported scenario, and explicit configuration.",
    );
  const scenario = input.scenario as CliAttackScenario;
  if (scenario === "fee-schedule-timing") {
    const settings = input.compileRequest.simulation;
    if (
      isRecord(settings) &&
      isRecord(settings.fees) &&
      isRecord(settings.fees.base) &&
      settings.fees.base.kind !== "fixed"
    ) {
      const periods = settings.fees.base.periodCount;
      if (typeof periods !== "string" || !/^[1-9]\d*$/.test(periods) || BigInt(periods) > 98n)
        throw new RangeError(
          "Local fee-timing budget: at most 98 scheduled periods (up to 100 clock candidates).",
        );
    }
  }
  const configuration = parseScenarioConfiguration(scenario, input.configuration);
  if (scenario !== "fee-schedule-timing") {
    const ticks = configuration.ticks as Record<string, bigint>;
    const iterations = configuration.requestedIterations as bigint;
    let agents = scenario === "sell-cascade" ? 0n : 1n;
    for (const key of [
      "supportingAgentDistribution",
      "cascadeAgentDistribution",
      "backgroundAgentDistribution",
    ]) {
      const distribution = configuration[key];
      if (isRecord(distribution) && isRecord(distribution.counts))
        for (const count of Object.values(distribution.counts)) {
          if (typeof count !== "bigint" || count < 0n)
            throw new RangeError("Population counts must be non-negative integers.");
          agents += count;
        }
    }
    if (
      typeof iterations !== "bigint" ||
      iterations <= 0n ||
      iterations > 10n ||
      typeof ticks.tickCount !== "bigint" ||
      ticks.tickCount <= 0n ||
      ticks.tickCount > 100n ||
      agents > 100n ||
      iterations * ticks.tickCount * agents > 2_000n
    )
      throw new RangeError(
        "Local web budget: 1–10 iterations, 1–100 ticks, at most 100 agents and 2,000 agent-ticks per attack.",
      );
  }
  if (
    input.warmupQuoteAtomic !== undefined &&
    (typeof input.warmupQuoteAtomic !== "string" ||
      !/^[1-9]\d{0,19}$/.test(input.warmupQuoteAtomic) ||
      BigInt(input.warmupQuoteAtomic) > 18_446_744_073_709_551_615n)
  )
    throw new RangeError("Warm-up must be a positive u64 quote-atomic string, or omitted.");
  return {
    compileRequest: input.compileRequest,
    candidateId: input.candidateId,
    scenario,
    configuration: input.configuration,
    ...(input.warmupQuoteAtomic === undefined
      ? {}
      : { warmupQuoteAtomic: input.warmupQuoteAtomic as string }),
  };
}

export function runWebAttack(input: WebAttackRequest): CliAttackDocument {
  return runAttackDocument(
    {
      ...(input.compileRequest as Record<string, unknown>),
      schemaVersion: 1,
      attacks: { [input.scenario]: input.configuration },
      ...(input.warmupQuoteAtomic ? { preScenarioBuyQuoteAtomic: input.warmupQuoteAtomic } : {}),
    },
    input.scenario,
    input.candidateId,
  );
}

export function attackWebDocument(input: unknown): WebAttackResponse {
  try {
    const request = parseWebAttack(input);
    if (request.scenario === "fee-schedule-timing") {
      const simulation = (request.compileRequest as Record<string, unknown>).simulation;
      if (
        isRecord(simulation) &&
        isRecord(simulation.fees) &&
        isRecord(simulation.fees.base) &&
        simulation.fees.base.kind === "fixed"
      ) {
        if (
          !compileDocument(request.compileRequest).draftCandidates.some(
            (candidate) => candidate.id === request.candidateId,
          )
        )
          throw new RangeError("Unknown or invalid draft for this exact compile request.");
        return {
          status: "unsupported",
          candidateId: request.candidateId,
          scenario: request.scenario,
          message:
            "Fee timing requires an explicitly configured scheduled base fee. This draft has fixed fees; no sweep ran and no configuration was changed.",
        };
      }
    }
    return presentAttack(runWebAttack(request));
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Attack failed; no completed metrics.",
    };
  }
}

export function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(serializeCliJson(value)) as JsonValue;
}

export function presentAttack(document: CliAttackDocument): WebAttackResponse {
  const result = document.result;
  return {
    status: document.status,
    candidateId: document.candidate?.id ?? "",
    scenario: document.scenario,
    message: document.failure?.message ?? document.evidence.note,
    metrics: result && result.status !== "failed" ? jsonSnapshot(result.metrics) : null,
    snapshot: jsonSnapshot(document),
    ...(result
      ? {
          summary:
            result.scenario === "fee-schedule-timing"
              ? {
                  seed: null,
                  requested: result.candidateCount.toString(),
                  completed: result.completedCandidates.toString(),
                  partial: "0",
                  failed: result.failedCandidates.toString(),
                  countUnit: "clock candidates" as const,
                  engineVersion: result.engineVersion,
                  sdkVersion: result.sdkVersion,
                }
              : {
                  seed: result.randomSeed.toString(),
                  requested: result.requestedIterations.toString(),
                  completed: result.completedIterations.toString(),
                  partial: result.partialIterations.toString(),
                  failed: result.failedIterations.toString(),
                  countUnit: "iterations" as const,
                  engineVersion: result.engineVersion,
                  sdkVersion: result.sdkVersion,
                },
          measurements: attackMeasurements(result),
        }
      : {}),
  };
}

function attackMeasurements(
  result: AttackResult,
): readonly { label: string; value: string; unit: string }[] {
  if (result.status === "failed") return [];
  switch (result.scenario) {
    case "opening-sniper":
      return [
        {
          label: "p95 signed attacker PnL",
          value: formatCurrencyAmount(result.metrics.attackerPnlQuote.p95.amount),
          unit: "quote human units",
        },
        {
          label: "p95 post-exit drawdown",
          value: result.metrics.drawdownAfterExitBps.p95.toString(),
          unit: "basis points",
        },
        {
          label: "p95 late-buyer price disadvantage",
          value: result.metrics.lateBuyerPriceDisadvantageBps.p95.toString(),
          unit: "basis points",
        },
      ];
    case "whale-entry":
      return [
        {
          label: "p95 price displacement",
          value: result.metrics.priceDisplacementBps.p95.toString(),
          unit: "basis points",
        },
        {
          label: "p95 tracked-holder concentration",
          value: result.metrics.postBuyConcentrationBps.p95.toString(),
          unit: "basis points; configured holders only",
        },
        {
          label: "p95 base acquired",
          value: formatCurrencyAmount(result.metrics.baseAcquired.p95.amount),
          unit: "base human units",
        },
      ];
    case "pump-and-dump":
      return [
        {
          label: "p95 signed attacker PnL",
          value: formatCurrencyAmount(result.metrics.attackerPnlQuote.p95.amount),
          unit: "quote human units",
        },
        {
          label: "p95 peak-to-trough drawdown",
          value: result.metrics.peakToTroughDrawdownBps.p95.toString(),
          unit: "basis points",
        },
        {
          label: "p95 recovery capital",
          value: formatCurrencyAmount(result.metrics.recoveryQuoteRequired.p95.amount),
          unit: "quote human units; separate percentile",
        },
      ];
    case "sell-cascade":
      return [
        {
          label: "p95 maximum drawdown",
          value: result.metrics.maximumDrawdownBps.p95.toString(),
          unit: "basis points",
        },
        {
          label: "p95 quote outflow",
          value: formatCurrencyAmount(result.metrics.quoteOutflow.p95.amount),
          unit: "quote human units",
        },
        {
          label: "p95 migration delay",
          value: result.metrics.migrationDelaySeconds.p95.toString(),
          unit: "seconds vs matched no-cascade baseline",
        },
      ];
    case "fee-schedule-timing":
      return [
        {
          label: "Best entry slot",
          value: result.metrics.bestEntryClock.slot.toString(),
          unit: "slot",
        },
        {
          label: "Best entry timestamp",
          value: result.metrics.bestEntryClock.timestampSeconds.toString(),
          unit: "seconds",
        },
        {
          label: "Signed PnL improvement",
          value: formatCurrencyAmount(result.metrics.pnlImprovementQuote.amount),
          unit: "quote human units",
        },
        {
          label: "Base fees saved",
          value: formatCurrencyAmount(result.metrics.feesSaved.base),
          unit: "base human units",
        },
        {
          label: "Quote fees saved",
          value: formatCurrencyAmount(result.metrics.feesSaved.quote),
          unit: "quote human units",
        },
      ];
  }
}
