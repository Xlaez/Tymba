import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { createDemoPoolState } from "../../examples/demo-market.js";
import { currencyAmount } from "./currency-amount.js";
import { analyzePriceStability } from "./price-stability-audit.js";
import { analyzeSniperExposure } from "./sniper-exposure-audit.js";
import { validateMarketIntent } from "./market-intent.js";
import { solveMarketCurve } from "./inverse-curve-solver.js";
import { runDeterministicSimulation, quoteBuy } from "./simulator.js";
import type { InverseCurveCandidate, InverseCurveSolverOptions } from "./inverse-curve-solver.js";
import type { SolverObjectiveWeights } from "./solver-objective.js";
import { generateHardenedCandidate } from "./harden-market-candidate.js";
import { resimulateHardenedCandidate } from "./harden-market-resimulation.js";
import type { HardeningReplayConfiguration } from "./harden-market-resimulation.js";
import { compareHardenedCandidate } from "./harden-market-comparison.js";
import { runOpeningSniperAttack } from "./attacks/opening-sniper.js";
import type { AttackResult, OpeningSniperResult } from "./attack-result.js";

const objectiveWeights: SolverObjectiveWeights = {
  quoteError: new Decimal("0.25"),
  distributionError: new Decimal("0.25"),
  migrationPriceError: new Decimal("0.1"),
  earlyPriceImpact: new Decimal(0),
  attackProfitability: new Decimal(0),
  complexity: new Decimal("0.4"),
};

function makeMarket() {
  const result = validateMarketIntent({
    assets: {
      base: { symbol: "MKT", decimals: 9 },
      quote: { symbol: "USDC", decimals: 6 },
    },
    supply: { totalBase: "1000000000" },
    pricing: { startPrice: "0.0002", migrationPrice: "0.002" },
    targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
    preferences: { maxEarlyPriceImpactPct: "15" },
    solver: { maxSegments: 3 },
  });
  if (result.status === "invalid") throw new Error("Expected valid market intent");
  return result.normalized;
}

function isOpeningSniperResult(result: AttackResult): result is OpeningSniperResult {
  return result.scenario === "opening-sniper" && result.status === "completed";
}

describe("hardened candidate generation", () => {
  it("replays a seeded attack and lowers raw risk without changing the original intent", () => {
    const market = makeMarket();
    const baseState = createDemoPoolState();
    const simulation = {
      fees: baseState.fees,
      migration: baseState.migration,
      supplyMode: baseState.supply.mode,
      clock: baseState.clock,
      activationPoint: baseState.activationPoint,
      activationType: baseState.activationType,
    } as const;
    const options: InverseCurveSolverOptions = {
      objectiveWeights,
      simulation,
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
      earlyPriceImpactEvaluator: ({ candidateId, curve, probeQuoteAtomic }) => {
        const quote = quoteBuy(probeQuoteAtomic, {
          ...baseState,
          curve,
          currentSqrtPriceQ64x64: curve.startSqrtPriceQ64x64,
        });
        return {
          priceImpactBps: quote.metrics.priceImpactBps,
          evidenceId: `impact-${candidateId}`,
        };
      },
    };
    const initialSolve = solveMarketCurve(market, options);
    const originalCandidate = initialSolve.candidates.find(
      ({ meetsRequestedTargets }) => meetsRequestedTargets,
    );
    if (!originalCandidate) throw new Error("Expected a baseline candidate that meets intent");
    const sourceRun = runDeterministicSimulation({
      id: "hardening-baseline-probe",
      initialState: originalCandidate.simulation.initialState,
      trades: [{ direction: "buy", inputAtomic: 5_000_000_000n }],
    });
    const audit = analyzePriceStability({
      auditId: "hardening-baseline-audit",
      candidateId: originalCandidate.id,
      deterministicRuns: [sourceRun],
    });
    const finding = audit.findings.find(({ ruleId }) => ruleId === "price-stability.early-impact");
    if (!finding) throw new Error("Expected first-trade early-impact finding");
    const intentBefore = JSON.stringify({
      totalBaseAtomic: market.totalBaseAtomic.toString(),
      quoteTargetAtomic: market.quoteToMigrationAtomic?.toString(),
      distributionBps: market.targetBaseDistributionBps?.toString(),
      startPrice: market.startPrice.toFixed(),
      migrationPrice: market.migrationPrice.toFixed(),
    });

    const result = generateHardenedCandidate({
      originalMarket: market,
      originalCandidate,
      originalSolverOptions: options,
      selectedFindings: [finding],
      addedRiskWeights: { earlyPriceImpact: new Decimal("0.3") },
    });

    expect(finding.severityValueBps).toBeLessThanOrEqual(market.maxEarlyPriceImpactBps ?? 0n);
    expect(result.status).toBe("generated");
    expect(result.originalMarket).toBe(market);
    expect(result.originalCandidate).toBe(originalCandidate);
    expect(result.selectedFindings).toEqual([finding]);
    expect(result.baselineMeetsRequestedTargets).toBe(true);
    expect(result.hardenedCandidate?.meetsRequestedTargets).toBe(true);
    expect(result.hardenedCandidate?.verificationStatus).toBe("unverified");
    expect(result.hardenedCandidate?.metrics.quoteToMigration.raw).toBe(
      market.quoteToMigrationAtomic,
    );
    expect(result.hardenedCandidate?.metrics.baseDistributedBps).toBe(
      market.targetBaseDistributionBps,
    );
    expect(
      result.hardenedCandidate?.objective.measurements.earlyPriceImpactBps,
    ).toBeLessThanOrEqual(market.maxEarlyPriceImpactBps ?? 0n);
    expect(
      JSON.stringify({
        totalBaseAtomic: market.totalBaseAtomic.toString(),
        quoteTargetAtomic: market.quoteToMigrationAtomic?.toString(),
        distributionBps: market.targetBaseDistributionBps?.toString(),
        startPrice: market.startPrice.toFixed(),
        migrationPrice: market.migrationPrice.toFixed(),
      }),
    ).toBe(intentBefore);
    expect(result.conversion.mappings[0]?.sourceReference).toBe(sourceRun.id);
    expect(result.issues).toEqual([]);

    const supportingAgents = {
      counts: {
        "retail-buyer": 1n,
        whale: 0n,
        sniper: 0n,
        "momentum-trader": 0n,
        "profit-taker": 0n,
        "panic-seller": 0n,
        "random-trader": 0n,
      },
      templates: {
        "retail-buyer": {
          id: "replay-retail",
          archetype: "retail-buyer" as const,
          initialQuoteBalanceAtomic: 20_000_000_000n,
          initialBaseBalanceAtomic: 0n,
          initialBaseCostBasisQuoteAtomic: 0n,
          minimumBuyQuoteAtomic: 5_000_000_000n,
          maximumBuyQuoteAtomic: 5_000_000_000n,
          buyProbabilityBps: 10_000n,
          sellProbabilityBps: 0n,
          sellShareBps: 10_000n,
        },
      },
    };
    const replayConfiguration: HardeningReplayConfiguration = {
      deterministic: {
        id: "hardening-deterministic-replay",
        trades: [{ direction: "buy", inputAtomic: 5_000_000_000n }],
      },
      stochastic: {
        id: "hardening-stochastic-replay",
        randomSeed: 8821n,
        requestedIterations: 2n,
        agentDistribution: supportingAgents,
        ticks: {
          tickCount: 4n,
          slotsPerTick: 1n,
          secondsPerTick: 1n,
          executionOrder: "configured",
        },
      },
      attacks: [
        {
          scenario: "opening-sniper",
          id: "hardening-sniper-replay",
          configuration: {
            randomSeed: 9921n,
            requestedIterations: 2n,
            supportingAgentDistribution: supportingAgents,
            attacker: {
              id: "replay-sniper",
              initialQuoteBalanceAtomic: 500_000_000n,
              buyQuoteAtomic: 100_000_000n,
              holdTicks: 1n,
              minimumOtherBuyerBaseAtomic: 1n,
              exitShareBps: 10_000n,
            },
            ticks: { tickCount: 4n, slotsPerTick: 1n, secondsPerTick: 1n },
          },
        },
      ],
    };
    const replays = resimulateHardenedCandidate(result, replayConfiguration);
    const comparison = compareHardenedCandidate(result, replays);

    expect(replays.originalCandidateId).toBe(originalCandidate.id);
    expect(replays.hardenedCandidateId).toBe(result.hardenedCandidate?.id);
    expect(replays.replayConfiguration).toBe(replayConfiguration);
    expect(comparison.status).toBe("completed");
    expect(comparison.generation).toBe(result);
    expect(comparison.resimulation).toBe(replays);
    expect(comparison.generation.originalCandidate).toBe(originalCandidate);
    expect(comparison.generation.selectedFindings).toEqual([finding]);
    expect(comparison.generation.selectedFindings[0]?.evidence).toEqual(finding.evidence);
    expect(comparison.resimulation.baseline.stochastic).toMatchObject({
      status: "completed",
      result: { randomSeed: 8821n },
    });
    expect(comparison.originalCandidateId).toBe(originalCandidate.id);
    expect(comparison.hardenedCandidateId).toBe(result.hardenedCandidate?.id);
    expect(comparison.severityPolicyVersions).toEqual(["demo/demo-v1"]);
    expect(comparison.unsupportedSelectedFindings).toEqual([]);
    const quoteError = comparison.metrics.find(({ id }) => id === "quote-target-error");
    expect(quoteError?.status).toBe("compared");
    expect(quoteError?.baseline).toMatchObject({ kind: "amount", asset: "quote", raw: 0n });
    expect(quoteError?.hardened).toMatchObject({ kind: "amount", asset: "quote", raw: 0n });
    expect(
      comparison.metrics.find(({ id }) => id === "base-distribution-target-error")?.baseline,
    ).toMatchObject({ kind: "basis-points", value: 0n });
    const migrationPriceError = comparison.metrics.find(
      ({ id }) => id === "migration-price-target-error",
    )?.baseline;
    expect(migrationPriceError?.kind).toBe("decimal");
    if (migrationPriceError?.kind !== "decimal") throw new Error("Expected decimal error value");
    expect(migrationPriceError.value.isFinite()).toBe(true);
    expect(migrationPriceError.value.gte(0)).toBe(true);
    expect(comparison.metrics.find(({ id }) => id === "segment-count")?.baseline).toMatchObject({
      kind: "count",
      value: 3n,
    });
    expect(
      comparison.metrics.find(({ id }) => id === "curve-completion-quote-fees")?.baseline,
    ).toMatchObject({ kind: "amount", asset: "quote" });
    const selectedRisk = comparison.metrics.find(({ id }) => id === `selected-risk-${finding.id}`);
    const sniperConfig = replayConfiguration.attacks[0];
    if (sniperConfig?.scenario !== "opening-sniper") throw new Error("Expected sniper config");
    expect(selectedRisk?.status).toBe("compared");
    expect(selectedRisk?.baseline?.kind).toBe("basis-points");
    expect(selectedRisk?.hardened?.kind).toBe("basis-points");
    expect(typeof selectedRisk?.improved).toBe("boolean");
    expect(comparison.metrics.find(({ id }) => id === "attack-0-sniper-p95-pnl")?.status).not.toBe(
      "unavailable",
    );
    expect(replays.baseline.deterministic.status).toBe("completed");
    expect(replays.hardened.deterministic.status).toBe("completed");
    expect(replays.baseline.stochastic.status).toBe("completed");
    expect(replays.hardened.stochastic.status).toBe("completed");
    if (
      replays.baseline.stochastic.status !== "completed" ||
      replays.hardened.stochastic.status !== "completed"
    ) {
      throw new Error("Expected stochastic replay results");
    }
    if (
      replays.baseline.stochastic.result.status === "failed" ||
      replays.hardened.stochastic.result.status === "failed"
    ) {
      throw new Error("Expected completed stochastic simulations");
    }
    expect(
      replays.baseline.stochastic.result.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    ).toEqual(
      replays.hardened.stochastic.result.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );
    const baselineAttack = replays.baseline.attacks[0]?.attempt;
    const hardenedAttack = replays.hardened.attacks[0]?.attempt;
    expect(baselineAttack?.status).toBe("completed");
    expect(hardenedAttack?.status).toBe("completed");
    if (
      baselineAttack?.status !== "completed" ||
      hardenedAttack?.status !== "completed" ||
      baselineAttack.result.scenario !== "opening-sniper" ||
      hardenedAttack.result.scenario !== "opening-sniper"
    ) {
      throw new Error("Expected opening-sniper replay results");
    }
    expect(baselineAttack.result.iterationOutcomes.map(({ randomSeed }) => randomSeed)).toEqual(
      hardenedAttack.result.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );
    const failedWarmupReplay = resimulateHardenedCandidate(result, {
      ...replayConfiguration,
      warmupQuoteAtomic: 1_000_000_000_000_000n,
    });
    expect(failedWarmupReplay.status).toBe("failed");
    expect(failedWarmupReplay.baseline.deterministic.status).toBe("failed");
    expect(failedWarmupReplay.hardened.attacks[0]?.attempt.status).toBe("failed");
    const failedComparison = compareHardenedCandidate(result, failedWarmupReplay);
    expect(failedComparison.status).toBe("failed");
    const unavailableRisk = failedComparison.metrics.find(
      ({ id }) => id === `selected-risk-${finding.id}`,
    );
    expect(unavailableRisk?.status).toBe("unavailable");
    expect(unavailableRisk?.baseline).toBeUndefined();
    expect(unavailableRisk?.hardened).toBeUndefined();
    expect(unavailableRisk?.reason).toContain("warm-up");
    expect(failedComparison.metrics.find(({ id }) => id === "quote-target-error")?.status).toBe(
      "compared",
    );

    const runCandidateAttack = (
      candidateId: string,
      curve: typeof originalCandidate.curve,
    ): OpeningSniperResult => {
      const attack = runOpeningSniperAttack({
        ...sniperConfig.configuration,
        id: `hardening-objective-${candidateId}`,
        initialState: {
          ...originalCandidate.simulation.initialState,
          curve,
          currentSqrtPriceQ64x64: curve.startSqrtPriceQ64x64,
        },
      });
      if (!isOpeningSniperResult(attack)) {
        throw new Error("Expected a completed opening-sniper run");
      }
      return attack;
    };
    const feasibleCandidates = initialSolve.candidates.filter(
      ({ meetsRequestedTargets }) => meetsRequestedTargets,
    );
    let riskierBaseline:
      | { candidate: InverseCurveCandidate; attack: OpeningSniperResult }
      | undefined;
    for (const candidate of feasibleCandidates) {
      const attack = runCandidateAttack(candidate.id, candidate.curve);
      if (
        riskierBaseline === undefined ||
        attack.metrics.attackerPnlQuote.p95.amount.raw >
          riskierBaseline.attack.metrics.attackerPnlQuote.p95.amount.raw
      ) {
        riskierBaseline = { candidate, attack };
      }
    }
    if (!riskierBaseline) throw new Error("Expected a feasible candidate for the seeded demo");
    expect(riskierBaseline.attack.metrics.attackerPnlQuote.p95.amount.raw).toBeGreaterThan(0n);

    const sniperAudit = analyzeSniperExposure({
      auditId: "hardening-sniper-audit",
      candidateId: riskierBaseline.candidate.id,
      openingSniperRuns: [
        {
          result: riskierBaseline.attack,
          capitalAtRiskQuote: {
            asset: "quote",
            amount: currencyAmount(
              sniperConfig.configuration.attacker.initialQuoteBalanceAtomic,
              market.quoteDecimals,
            ),
          },
        },
      ],
    });
    const sniperFinding = sniperAudit.findings[0];
    if (!sniperFinding) throw new Error("Expected a raw-metric sniper finding");
    const attackOptions: InverseCurveSolverOptions = {
      ...options,
      attackExposureEvaluator: ({ candidateId, curve }) => {
        const attack = runCandidateAttack(candidateId, curve);
        return {
          attackerProfitQuoteAtomic: attack.metrics.attackerPnlQuote.p95.amount.raw,
          attackerCapitalQuoteAtomic: sniperConfig.configuration.attacker.initialQuoteBalanceAtomic,
          evidenceId: attack.id,
        };
      },
    };
    const attackHardening = generateHardenedCandidate({
      originalMarket: market,
      originalCandidate: riskierBaseline.candidate,
      originalSolverOptions: attackOptions,
      selectedFindings: [sniperFinding],
      addedRiskWeights: { attackProfitability: new Decimal("0.3") },
    });
    expect(attackHardening.status).toBe("generated");
    expect(attackHardening.baselineMeetsRequestedTargets).toBe(true);
    expect(attackHardening.hardenedCandidate).toBeDefined();
    expect(attackHardening.hardenedCandidate?.id).not.toBe(riskierBaseline.candidate.id);

    const attackReplays = resimulateHardenedCandidate(attackHardening, replayConfiguration);
    const attackComparison = compareHardenedCandidate(attackHardening, attackReplays);
    const selectedSniperRisk = attackComparison.metrics.find(
      ({ id }) => id === `selected-risk-${sniperFinding.id}`,
    );
    expect(attackComparison.status).toBe("completed");
    expect(selectedSniperRisk?.status).toBe("compared");
    expect(selectedSniperRisk?.baseline).toEqual({ kind: "basis-points", value: 251n });
    expect(selectedSniperRisk?.hardened).toEqual({ kind: "basis-points", value: 199n });
    expect(selectedSniperRisk?.improved).toBe(true);
    expect(selectedSniperRisk?.delta).toBe(-52n);
    expect(attackHardening.hardenedCandidate?.verificationStatus).toBe("unverified");
    const baselineAttackAttempt = attackReplays.baseline.attacks[0]?.attempt;
    const hardenedAttackAttempt = attackReplays.hardened.attacks[0]?.attempt;
    if (
      baselineAttackAttempt?.status !== "completed" ||
      hardenedAttackAttempt?.status !== "completed"
    ) {
      throw new Error("Expected completed paired opening-sniper replay results");
    }
    const baselineAttackReplay = baselineAttackAttempt.result;
    const hardenedAttackReplay = hardenedAttackAttempt.result;
    if (
      !isOpeningSniperResult(baselineAttackReplay) ||
      !isOpeningSniperResult(hardenedAttackReplay)
    ) {
      throw new Error("Expected opening-sniper replay results");
    }
    expect(baselineAttackReplay.metrics.attackerPnlQuote.p95.amount.raw).toBe(12_562_158n);
    expect(hardenedAttackReplay.metrics.attackerPnlQuote.p95.amount.raw).toBe(9_961_208n);
    expect(baselineAttackReplay.iterationOutcomes.map(({ randomSeed }) => randomSeed)).toEqual(
      hardenedAttackReplay.iterationOutcomes.map(({ randomSeed }) => randomSeed),
    );

    const strictTargetResult = generateHardenedCandidate({
      originalMarket: { ...market, maxEarlyPriceImpactBps: 0n },
      originalCandidate,
      originalSolverOptions: {
        ...options,
        earlyPriceImpactEvaluator: ({ candidateId }) => ({
          priceImpactBps: 1n,
          evidenceId: `strict-impact-${candidateId}`,
        }),
      },
      selectedFindings: [finding],
      addedRiskWeights: { earlyPriceImpact: new Decimal("0.3") },
    });
    expect(strictTargetResult.status).toBe("unsatisfied");
    expect(strictTargetResult.hardenedCandidate).toBeUndefined();
    expect(strictTargetResult.rejectedCandidates.length).toBeGreaterThan(0);
    expect(
      strictTargetResult.rejectedCandidates.every(({ conflicts }) =>
        conflicts.some((conflict) => conflict.includes("exceeds the original 0 bps limit")),
      ),
    ).toBe(true);
  });

  it("refuses to compare against a baseline candidate built from a different curve", () => {
    const market = makeMarket();
    const baseState = createDemoPoolState();
    const options: InverseCurveSolverOptions = {
      objectiveWeights,
      simulation: {
        fees: baseState.fees,
        migration: baseState.migration,
        supplyMode: baseState.supply.mode,
        clock: baseState.clock,
        activationPoint: baseState.activationPoint,
        activationType: baseState.activationType,
      } as const,
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
      earlyPriceImpactEvaluator: ({ candidateId }) => ({
        priceImpactBps: 100n,
        evidenceId: `impact-${candidateId}`,
      }),
    };
    const initialSolve = solveMarketCurve(market, options);
    const originalCandidate = initialSolve.candidates.find(
      ({ meetsRequestedTargets }) => meetsRequestedTargets,
    );
    if (!originalCandidate) throw new Error("Expected a baseline candidate that meets intent");
    const sourceRun = runDeterministicSimulation({
      id: "hardening-target-preservation-probe",
      initialState: originalCandidate.simulation.initialState,
      trades: [{ direction: "buy", inputAtomic: 5_000_000_000n }],
    });
    const audit = analyzePriceStability({
      auditId: "hardening-target-preservation-audit",
      candidateId: originalCandidate.id,
      deterministicRuns: [sourceRun],
    });
    const finding = audit.findings.find(({ ruleId }) => ruleId === "price-stability.early-impact");
    if (!finding) throw new Error("Expected early-impact finding");
    const mismatchedBaseline = {
      ...originalCandidate,
      curve: {
        ...originalCandidate.curve,
        segments: originalCandidate.curve.segments.map((segment, index) =>
          index === 0 ? { ...segment, liquidity: segment.liquidity + 1n } : segment,
        ),
      },
    } as InverseCurveCandidate;

    const result = generateHardenedCandidate({
      originalMarket: market,
      originalCandidate: mismatchedBaseline,
      originalSolverOptions: options,
      selectedFindings: [finding],
      addedRiskWeights: { earlyPriceImpact: new Decimal("0.3") },
    });

    expect(result.status).toBe("unsatisfied");
    expect(result.originalCandidate).toBe(mismatchedBaseline);
    expect(result.solverResult).toBeUndefined();
    expect(result.issues.map(({ code }) => code)).toContain("baseline_candidate_mismatch");
  });
});
