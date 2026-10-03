import { Decimal } from "decimal.js";
import type { AuditEvidence, AuditFinding } from "./audit.js";
import type { AttackResult } from "./attack-result.js";
import type { HardenedCandidateGenerationResult } from "./harden-market-candidate.js";
import type {
  CandidateResimulationResult,
  HardeningResimulationResult,
  ReplayAttempt,
} from "./harden-market-resimulation.js";
import type { InverseCurveCandidate } from "./inverse-curve-solver.js";
import type { DeterministicSimulationResult, StochasticSimulationResult } from "./simulation.js";

const BASIS_POINTS = 10_000n;
const EARLY_STAGE_UPPER_BPS = 3_334n;
const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
type SuccessfulAttackResult = Exclude<AttackResult, { status: "failed" }>;

export type HardeningComparisonCategory =
  | "risk"
  | "quote-error"
  | "distribution"
  | "migration"
  | "complexity"
  | "fees";

export type HardeningComparisonStatus = "compared" | "partial" | "unavailable";

export type HardeningComparisonDirection =
  | "lower-is-better"
  | "higher-is-better"
  | "preserve"
  | "informational";

export type HardeningComparisonValue =
  | Readonly<{ kind: "amount"; asset: "base" | "quote"; raw: bigint; decimals: number }>
  | Readonly<{ kind: "basis-points"; value: bigint }>
  | Readonly<{ kind: "decimal"; value: Decimal }>
  | Readonly<{ kind: "count"; value: bigint }>
  | Readonly<{ kind: "boolean"; value: boolean }>;

export type HardeningMetricComparison = Readonly<{
  id: string;
  category: HardeningComparisonCategory;
  label: string;
  unit: string;
  direction: HardeningComparisonDirection;
  status: HardeningComparisonStatus;
  source: string;
  baseline?: HardeningComparisonValue;
  hardened?: HardeningComparisonValue;
  delta?: bigint | Decimal;
  improved?: boolean;
  evidenceReferences: readonly string[];
  selectedFindingIds?: readonly string[];
  reason?: string;
}>;

export type HardenedCandidateComparison = Readonly<{
  status: HardeningResimulationResult["status"];
  evidenceClassification: "modeled";
  verificationStatus: "unverified";
  generation: HardenedCandidateGenerationResult;
  resimulation: HardeningResimulationResult;
  originalCandidateId: string;
  hardenedCandidateId: string;
  severityPolicyVersions: readonly string[];
  metrics: readonly HardeningMetricComparison[];
  unsupportedSelectedFindings: readonly Readonly<{ findingId: string; reason: string }>[];
}>;

export function compareHardenedCandidate(
  generation: HardenedCandidateGenerationResult,
  resimulation: HardeningResimulationResult,
): HardenedCandidateComparison {
  validateInput(generation, resimulation);
  const hardenedCandidate = generation.hardenedCandidate;
  if (!hardenedCandidate) throw new TypeError("A hardened candidate is required for comparison");
  const metrics: HardeningMetricComparison[] = [];

  compareCandidateEconomics(generation, hardenedCandidate, metrics);
  compareReplayRisk(generation, resimulation, metrics);

  return {
    status: resimulation.status,
    evidenceClassification: "modeled",
    verificationStatus: "unverified",
    generation,
    resimulation,
    originalCandidateId: generation.originalCandidate.id,
    hardenedCandidateId: hardenedCandidate.id,
    severityPolicyVersions: unique(
      generation.selectedFindings.map(
        ({ severityPolicyId, severityPolicyVersion }) =>
          `${severityPolicyId}/${severityPolicyVersion}`,
      ),
    ),
    metrics,
    unsupportedSelectedFindings: generation.conversion.unsupportedFindings.map(
      ({ findingId, reason }) => ({ findingId, reason }),
    ),
  };
}

function compareCandidateEconomics(
  generation: HardenedCandidateGenerationResult,
  hardened: InverseCurveCandidate,
  metrics: HardeningMetricComparison[],
): void {
  const baseline = generation.originalCandidate;
  const market = generation.originalMarket;
  const baselineSimulationStatus = baseline.simulation.status;
  const hardenedSimulationStatus = hardened.simulation.status;
  const verificationStatus =
    baselineSimulationStatus === "partial" || hardenedSimulationStatus === "partial"
      ? "partial"
      : "compared";

  metrics.push(
    makeMetric({
      id: "quote-to-migration",
      category: "quote-error",
      label: "Quote required to reach migration",
      unit: "quote atomic units",
      direction: "informational",
      source: "candidate deterministic simulation",
      baseline: amountValue("quote", baseline.metrics.quoteToMigration.raw, market.quoteDecimals),
      hardened: amountValue("quote", hardened.metrics.quoteToMigration.raw, market.quoteDecimals),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "quote-target-error",
      category: "quote-error",
      label: "Absolute quote-target error",
      unit: "quote atomic units",
      direction: "lower-is-better",
      source: "candidate deterministic simulation",
      baseline:
        market.quoteToMigrationAtomic === undefined
          ? undefined
          : amountValue(
              "quote",
              absoluteDifference(
                baseline.metrics.quoteToMigration.raw,
                market.quoteToMigrationAtomic,
              ),
              market.quoteDecimals,
            ),
      hardened:
        market.quoteToMigrationAtomic === undefined
          ? undefined
          : amountValue(
              "quote",
              absoluteDifference(
                hardened.metrics.quoteToMigration.raw,
                market.quoteToMigrationAtomic,
              ),
              market.quoteDecimals,
            ),
      status: market.quoteToMigrationAtomic === undefined ? "unavailable" : verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
      reason:
        market.quoteToMigrationAtomic === undefined
          ? "The original intent does not specify a quote-to-migration target."
          : undefined,
    }),
    makeMetric({
      id: "base-distributed",
      category: "distribution",
      label: "Base supply distributed before migration",
      unit: "basis points",
      direction: "informational",
      source: "candidate deterministic simulation",
      baseline: bpsValue(baseline.metrics.baseDistributedBps),
      hardened: bpsValue(hardened.metrics.baseDistributedBps),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "base-distribution-target-error",
      category: "distribution",
      label: "Absolute base-distribution target error",
      unit: "basis points",
      direction: "lower-is-better",
      source: "candidate deterministic simulation",
      baseline:
        market.targetBaseDistributionBps === undefined
          ? undefined
          : bpsValue(
              absoluteDifference(
                baseline.metrics.baseDistributedBps,
                market.targetBaseDistributionBps,
              ),
            ),
      hardened:
        market.targetBaseDistributionBps === undefined
          ? undefined
          : bpsValue(
              absoluteDifference(
                hardened.metrics.baseDistributedBps,
                market.targetBaseDistributionBps,
              ),
            ),
      status: market.targetBaseDistributionBps === undefined ? "unavailable" : verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
      reason:
        market.targetBaseDistributionBps === undefined
          ? "The original intent does not specify a base-distribution target."
          : undefined,
    }),
    makeMetric({
      id: "migration-price",
      category: "migration",
      label: "Measured migration price",
      unit: `${market.assets.quote.symbol} per ${market.assets.base.symbol}`,
      direction: "informational",
      source: "candidate deterministic simulation",
      baseline: decimalValue(baseline.metrics.migrationPrice),
      hardened: decimalValue(hardened.metrics.migrationPrice),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "migration-price-target-error",
      category: "migration",
      label: "Relative migration-price target error",
      unit: "basis points",
      direction: "lower-is-better",
      source: "candidate deterministic simulation",
      baseline: bpsDecimalValue(
        relativeErrorBps(baseline.metrics.migrationPrice, market.migrationPrice),
      ),
      hardened: bpsDecimalValue(
        relativeErrorBps(hardened.metrics.migrationPrice, market.migrationPrice),
      ),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "migration-reached",
      category: "migration",
      label: "Curve-completion simulation reached migration",
      unit: "boolean",
      direction: "preserve",
      source: "candidate deterministic simulation",
      baseline: booleanValue(baseline.simulation.metrics.migrated),
      hardened: booleanValue(hardened.simulation.metrics.migrated),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "segment-count",
      category: "complexity",
      label: "Curve segment count",
      unit: "segments",
      direction: "lower-is-better",
      source: "candidate curve",
      baseline: countValue(baseline.curve.segments.length),
      hardened: countValue(hardened.curve.segments.length),
      status: "compared",
      evidenceReferences: [baseline.id, hardened.id],
    }),
    makeMetric({
      id: "curve-completion-base-fees",
      category: "fees",
      label: "Modeled fees through curve completion (base asset)",
      unit: "base atomic units",
      direction: "informational",
      source: "candidate deterministic simulation",
      baseline: amountValue(
        "base",
        baseline.simulation.metrics.feesGenerated.base.raw,
        baseline.simulation.metrics.feesGenerated.base.decimals,
      ),
      hardened: amountValue(
        "base",
        hardened.simulation.metrics.feesGenerated.base.raw,
        hardened.simulation.metrics.feesGenerated.base.decimals,
      ),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
    makeMetric({
      id: "curve-completion-quote-fees",
      category: "fees",
      label: "Modeled fees through curve completion (quote asset)",
      unit: "quote atomic units",
      direction: "informational",
      source: "candidate deterministic simulation",
      baseline: amountValue(
        "quote",
        baseline.simulation.metrics.feesGenerated.quote.raw,
        baseline.simulation.metrics.feesGenerated.quote.decimals,
      ),
      hardened: amountValue(
        "quote",
        hardened.simulation.metrics.feesGenerated.quote.raw,
        hardened.simulation.metrics.feesGenerated.quote.decimals,
      ),
      status: verificationStatus,
      evidenceReferences: [baseline.simulation.id, hardened.simulation.id],
    }),
  );
}

function compareReplayRisk(
  generation: HardenedCandidateGenerationResult,
  resimulation: HardeningResimulationResult,
  metrics: HardeningMetricComparison[],
): void {
  const baseline = resimulation.baseline;
  const hardened = resimulation.hardened;
  const baselineDeterministic = readDeterministic(baseline.deterministic);
  const hardenedDeterministic = readDeterministic(hardened.deterministic);
  metrics.push(
    fromReplayValues({
      id: "replay-maximum-price-impact",
      category: "risk",
      label: "Maximum single-trade price impact",
      unit: "basis points",
      direction: "lower-is-better",
      source: "deterministic trade replay",
      baseline: baselineDeterministic?.metrics.maximumPriceImpactBps,
      hardened: hardenedDeterministic?.metrics.maximumPriceImpactBps,
      baselineStatus: deterministicStatus(baseline.deterministic),
      hardenedStatus: deterministicStatus(hardened.deterministic),
      evidenceReferences: [baselineDeterministic?.id, hardenedDeterministic?.id],
      failures: [attemptFailure(baseline.deterministic), attemptFailure(hardened.deterministic)],
    }),
    fromReplayValues({
      id: "replay-maximum-drawdown",
      category: "risk",
      label: "Maximum observed replay drawdown",
      unit: "basis points",
      direction: "lower-is-better",
      source: "deterministic trade replay",
      baseline: baselineDeterministic?.metrics.maximumDrawdownBps,
      hardened: hardenedDeterministic?.metrics.maximumDrawdownBps,
      baselineStatus: deterministicStatus(baseline.deterministic),
      hardenedStatus: deterministicStatus(hardened.deterministic),
      evidenceReferences: [baselineDeterministic?.id, hardenedDeterministic?.id],
      failures: [attemptFailure(baseline.deterministic), attemptFailure(hardened.deterministic)],
    }),
  );

  const baselineStochastic = readStochastic(baseline.stochastic);
  const hardenedStochastic = readStochastic(hardened.stochastic);
  metrics.push(
    fromReplayValues({
      id: "stochastic-p95-maximum-price-impact",
      category: "risk",
      label: "Stochastic p95 maximum single-trade price impact",
      unit: "basis points",
      direction: "lower-is-better",
      source: "seeded stochastic replay",
      baseline: baselineStochastic?.summary.maximumPriceImpactBps.p95,
      hardened: hardenedStochastic?.summary.maximumPriceImpactBps.p95,
      baselineStatus: stochasticStatus(baseline.stochastic),
      hardenedStatus: stochasticStatus(hardened.stochastic),
      evidenceReferences: [baselineStochastic?.id, hardenedStochastic?.id],
      failures: [attemptFailure(baseline.stochastic), attemptFailure(hardened.stochastic)],
    }),
    fromReplayValues({
      id: "stochastic-p95-maximum-drawdown",
      category: "risk",
      label: "Stochastic p95 maximum drawdown",
      unit: "basis points",
      direction: "lower-is-better",
      source: "seeded stochastic replay",
      baseline: baselineStochastic?.summary.maximumDrawdownBps.p95,
      hardened: hardenedStochastic?.summary.maximumDrawdownBps.p95,
      baselineStatus: stochasticStatus(baseline.stochastic),
      hardenedStatus: stochasticStatus(hardened.stochastic),
      evidenceReferences: [baselineStochastic?.id, hardenedStochastic?.id],
      failures: [attemptFailure(baseline.stochastic), attemptFailure(hardened.stochastic)],
    }),
  );

  compareAttackRisks(resimulation, metrics);
  compareSelectedFindingRisks(generation, resimulation, metrics);
}

function compareAttackRisks(
  resimulation: HardeningResimulationResult,
  metrics: HardeningMetricComparison[],
): void {
  for (const [index, replay] of resimulation.replayConfiguration.attacks.entries()) {
    const baselineAttempt = resimulation.baseline.attacks[index]?.attempt;
    const hardenedAttempt = resimulation.hardened.attacks[index]?.attempt;
    const baseline = readAttack(baselineAttempt, replay.scenario);
    const hardened = readAttack(hardenedAttempt, replay.scenario);
    const context = {
      source: `${replay.scenario} attack replay`,
      evidenceReferences: [baseline.reference, hardened.reference],
      failures: [baseline.reason, hardened.reason],
      baselineStatus: baseline.status,
      hardenedStatus: hardened.status,
    } as const;

    switch (replay.scenario) {
      case "opening-sniper": {
        const left = baseline.result?.scenario === "opening-sniper" ? baseline.result : undefined;
        const right = hardened.result?.scenario === "opening-sniper" ? hardened.result : undefined;
        metrics.push(
          fromReplayValues({
            ...context,
            id: `attack-${index}-sniper-p95-pnl`,
            category: "risk",
            label: "Opening-sniper p95 signed profit",
            unit: "quote atomic units",
            direction: "lower-is-better",
            baseline: left
              ? amountValue(
                  "quote",
                  left.metrics.attackerPnlQuote.p95.amount.raw,
                  left.metrics.attackerPnlQuote.p95.amount.decimals,
                )
              : undefined,
            hardened: right
              ? amountValue(
                  "quote",
                  right.metrics.attackerPnlQuote.p95.amount.raw,
                  right.metrics.attackerPnlQuote.p95.amount.decimals,
                )
              : undefined,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-sniper-late-buyer-disadvantage`,
            category: "risk",
            label: "Opening-sniper p95 late-buyer price disadvantage",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.lateBuyerPriceDisadvantageBps.p95,
            hardened: right?.metrics.lateBuyerPriceDisadvantageBps.p95,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-sniper-drawdown`,
            category: "risk",
            label: "Opening-sniper p95 drawdown after exit",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.drawdownAfterExitBps.p95,
            hardened: right?.metrics.drawdownAfterExitBps.p95,
          }),
        );
        break;
      }
      case "whale-entry": {
        const left = baseline.result?.scenario === "whale-entry" ? baseline.result : undefined;
        const right = hardened.result?.scenario === "whale-entry" ? hardened.result : undefined;
        metrics.push(
          fromReplayValues({
            ...context,
            id: `attack-${index}-whale-price-displacement`,
            category: "risk",
            label: "Whale-entry p95 price displacement",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.priceDisplacementBps.p95,
            hardened: right?.metrics.priceDisplacementBps.p95,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-whale-concentration`,
            category: "risk",
            label: "Whale-entry p95 tracked-holder concentration",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.postBuyConcentrationBps.p95,
            hardened: right?.metrics.postBuyConcentrationBps.p95,
          }),
        );
        break;
      }
      case "pump-and-dump": {
        const left = baseline.result?.scenario === "pump-and-dump" ? baseline.result : undefined;
        const right = hardened.result?.scenario === "pump-and-dump" ? hardened.result : undefined;
        metrics.push(
          fromReplayValues({
            ...context,
            id: `attack-${index}-pump-dump-pnl`,
            category: "risk",
            label: "Pump-and-dump p95 signed attacker profit",
            unit: "quote atomic units",
            direction: "lower-is-better",
            baseline: left
              ? amountValue(
                  "quote",
                  left.metrics.attackerPnlQuote.p95.amount.raw,
                  left.metrics.attackerPnlQuote.p95.amount.decimals,
                )
              : undefined,
            hardened: right
              ? amountValue(
                  "quote",
                  right.metrics.attackerPnlQuote.p95.amount.raw,
                  right.metrics.attackerPnlQuote.p95.amount.decimals,
                )
              : undefined,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-pump-dump-drawdown`,
            category: "risk",
            label: "Pump-and-dump p95 peak-to-trough drawdown",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.peakToTroughDrawdownBps.p95,
            hardened: right?.metrics.peakToTroughDrawdownBps.p95,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-pump-dump-late-buyer-loss`,
            category: "risk",
            label: "Pump-and-dump p95 late-buyer loss",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.lateBuyerLossBps.p95,
            hardened: right?.metrics.lateBuyerLossBps.p95,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-pump-dump-recovery-quote`,
            category: "risk",
            label: "Pump-and-dump p95 recovery quote required",
            unit: "quote atomic units",
            direction: "lower-is-better",
            baseline: left
              ? amountValue(
                  "quote",
                  left.metrics.recoveryQuoteRequired.p95.amount.raw,
                  left.metrics.recoveryQuoteRequired.p95.amount.decimals,
                )
              : undefined,
            hardened: right
              ? amountValue(
                  "quote",
                  right.metrics.recoveryQuoteRequired.p95.amount.raw,
                  right.metrics.recoveryQuoteRequired.p95.amount.decimals,
                )
              : undefined,
          }),
        );
        break;
      }
      case "sell-cascade": {
        const left = baseline.result?.scenario === "sell-cascade" ? baseline.result : undefined;
        const right = hardened.result?.scenario === "sell-cascade" ? hardened.result : undefined;
        metrics.push(
          fromReplayValues({
            ...context,
            id: `attack-${index}-sell-cascade-drawdown`,
            category: "risk",
            label: "Sell-cascade p95 maximum drawdown",
            unit: "basis points",
            direction: "lower-is-better",
            baseline: left?.metrics.maximumDrawdownBps.p95,
            hardened: right?.metrics.maximumDrawdownBps.p95,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-sell-cascade-recovery-quote`,
            category: "risk",
            label: "Sell-cascade p95 recovery quote required",
            unit: "quote atomic units",
            direction: "lower-is-better",
            baseline: left
              ? amountValue(
                  "quote",
                  left.metrics.recoveryQuoteRequired.p95.amount.raw,
                  left.metrics.recoveryQuoteRequired.p95.amount.decimals,
                )
              : undefined,
            hardened: right
              ? amountValue(
                  "quote",
                  right.metrics.recoveryQuoteRequired.p95.amount.raw,
                  right.metrics.recoveryQuoteRequired.p95.amount.decimals,
                )
              : undefined,
          }),
          fromReplayValues({
            ...context,
            id: `attack-${index}-sell-cascade-migration-delay`,
            category: "risk",
            label: "Sell-cascade p95 migration delay",
            unit: "seconds",
            direction: "informational",
            baseline: left ? countValue(left.metrics.migrationDelaySeconds.p95) : undefined,
            hardened: right ? countValue(right.metrics.migrationDelaySeconds.p95) : undefined,
          }),
        );
        break;
      }
      case "fee-schedule-timing": {
        const left =
          baseline.result?.scenario === "fee-schedule-timing" ? baseline.result : undefined;
        const right =
          hardened.result?.scenario === "fee-schedule-timing" ? hardened.result : undefined;
        metrics.push(
          fromReplayValues({
            ...context,
            id: `attack-${index}-fee-timing-pnl-improvement`,
            category: "risk",
            label: "Fee-schedule timing attack PnL improvement",
            unit: "quote atomic units",
            direction: "lower-is-better",
            baseline: left
              ? amountValue(
                  "quote",
                  left.metrics.pnlImprovementQuote.amount.raw,
                  left.metrics.pnlImprovementQuote.amount.decimals,
                )
              : undefined,
            hardened: right
              ? amountValue(
                  "quote",
                  right.metrics.pnlImprovementQuote.amount.raw,
                  right.metrics.pnlImprovementQuote.amount.decimals,
                )
              : undefined,
          }),
        );
        break;
      }
    }
  }
}

function compareSelectedFindingRisks(
  generation: HardenedCandidateGenerationResult,
  resimulation: HardeningResimulationResult,
  metrics: HardeningMetricComparison[],
): void {
  for (const mapping of generation.conversion.mappings) {
    const finding = generation.selectedFindings.find(({ id }) => id === mapping.findingId);
    if (!finding) continue;
    if (mapping.objectiveTerm === "earlyPriceImpact") {
      const probe = readEarlyImpactProbe(finding);
      const baseline = selectedEarlyImpact(resimulation.baseline, probe);
      const hardened = selectedEarlyImpact(resimulation.hardened, probe);
      metrics.push(
        fromReplayValues({
          id: `selected-risk-${mapping.findingId}`,
          category: "risk",
          label: "Selected early price-impact finding replay",
          unit: "basis points",
          direction: "lower-is-better",
          source: "same first-trade quote probe as selected audit finding",
          baseline: baseline?.value,
          hardened: hardened?.value,
          baselineStatus: baseline?.status ?? "unavailable",
          hardenedStatus: hardened?.status ?? "unavailable",
          evidenceReferences: [baseline?.reference, hardened?.reference],
          failures: [baseline?.reason, hardened?.reason],
          selectedFindingIds: [mapping.findingId],
        }),
      );
    } else {
      const capital = readQuoteAmountEvidence(
        finding.evidence.find(
          ({ metric }) => metric === "explicit opening attack capital-at-risk basis (quote amount)",
        ),
      );
      const baseline = selectedSniperReturn(resimulation, "baseline", capital);
      const hardened = selectedSniperReturn(resimulation, "hardened", capital);
      metrics.push(
        fromReplayValues({
          id: `selected-risk-${mapping.findingId}`,
          category: "risk",
          label: "Selected opening-sniper return replay",
          unit: "basis points of explicit quote capital at risk",
          direction: "lower-is-better",
          source: "opening-sniper p95 PnL normalized by retained capital basis",
          baseline: baseline?.value,
          hardened: hardened?.value,
          baselineStatus: baseline?.status ?? "unavailable",
          hardenedStatus: hardened?.status ?? "unavailable",
          evidenceReferences: [baseline?.reference, hardened?.reference],
          failures: [baseline?.reason, hardened?.reason],
          selectedFindingIds: [mapping.findingId],
        }),
      );
    }
  }

  for (const unsupported of generation.conversion.unsupportedFindings) {
    metrics.push(
      makeMetric({
        id: `selected-risk-${unsupported.findingId}`,
        category: "risk",
        label: "Selected audit finding is not comparable to a supported solver metric",
        unit: "unavailable",
        direction: "informational",
        status: "unavailable",
        source: "audit-to-solver mapping",
        evidenceReferences: [unsupported.findingId],
        selectedFindingIds: [unsupported.findingId],
        reason: unsupported.reason,
      }),
    );
  }
}

function selectedEarlyImpact(
  result: CandidateResimulationResult,
  probe: Readonly<{ raw: bigint; decimals: number }> | undefined,
):
  | Readonly<{
      value?: HardeningComparisonValue | undefined;
      status?: HardeningComparisonStatus | undefined;
      reference?: string | undefined;
      reason?: string | undefined;
    }>
  | undefined {
  if (!probe)
    return { reason: "The selected finding does not retain its first-trade quote probe." };
  const simulation = readDeterministic(result.deterministic);
  if (!simulation)
    return {
      reason: attemptFailure(result.deterministic) ?? "Deterministic replay is unavailable.",
    };
  const firstTrade = simulation.trades[0];
  if (
    !firstTrade ||
    firstTrade.direction !== "buy" ||
    firstTrade.requestedInput.asset !== "quote" ||
    firstTrade.requestedInput.amount.raw !== probe.raw ||
    firstTrade.requestedInput.amount.decimals !== probe.decimals
  ) {
    return {
      reason:
        "The deterministic replay does not begin with the selected finding's exact quote-buy probe.",
    };
  }
  const midpoint =
    (firstTrade.metrics.migrationProgressBeforeBps + firstTrade.metrics.migrationProgressAfterBps) /
    2n;
  if (midpoint >= EARLY_STAGE_UPPER_BPS) {
    return { reason: "The exact replay probe does not remain in the early-curve audit stage." };
  }
  return {
    value: bpsValue(firstTrade.metrics.priceImpactBps),
    status: simulation.status === "partial" ? "partial" : "compared",
    reference: simulation.id,
  };
}

function selectedSniperReturn(
  resimulation: HardeningResimulationResult,
  candidate: "baseline" | "hardened",
  capital: Readonly<{ raw: bigint; decimals: number }> | undefined,
):
  | Readonly<{
      value?: HardeningComparisonValue | undefined;
      status?: HardeningComparisonStatus | undefined;
      reference?: string | undefined;
      reason?: string | undefined;
    }>
  | undefined {
  if (!capital || capital.raw <= 0n)
    return { reason: "The selected finding has no positive retained quote-capital basis." };
  const attempts = resimulation[candidate].attacks;
  const configIndex = resimulation.replayConfiguration.attacks.findIndex(
    ({ scenario, configuration }) =>
      scenario === "opening-sniper" &&
      configuration.attacker.initialQuoteBalanceAtomic === capital.raw,
  );
  if (configIndex < 0) {
    return {
      reason:
        "No replayed opening-sniper configuration uses the selected finding's capital-at-risk amount.",
    };
  }
  const attempt = attempts[configIndex]?.attempt;
  const attack = readAttack(attempt, "opening-sniper");
  if (attack.result?.scenario !== "opening-sniper") {
    return { reason: attack.reason ?? "Comparable opening-sniper replay is unavailable." };
  }
  if (!attack.reference) return { reason: "Opening-sniper replay reference is unavailable." };
  const pnl = attack.result.metrics.attackerPnlQuote.p95;
  if (pnl.amount.decimals !== capital.decimals) {
    return {
      reason: "Opening-sniper replay PnL and selected capital basis use different quote scales.",
    };
  }
  const raw = pnl.amount.raw <= 0n ? 0n : (pnl.amount.raw * BASIS_POINTS) / capital.raw;
  return {
    value: bpsValue(raw),
    status: attack.status,
    reference: attack.reference,
  };
}

function readEarlyImpactProbe(
  finding: AuditFinding,
): Readonly<{ raw: bigint; decimals: number }> | undefined {
  const ordinal = finding.evidence.find(
    ({ metric }) => metric === "maximum-impact source trade ordinal",
  );
  const input = finding.evidence.find(
    ({ metric }) => metric === "maximum-impact buy trade requested input",
  );
  if (
    ordinal?.value.kind !== "count" ||
    ordinal.value.value !== 0n ||
    input?.reference !== finding.evidence[0]?.reference ||
    input.value.kind !== "amount" ||
    input.value.value.asset !== "quote"
  ) {
    return undefined;
  }
  return { raw: input.value.value.amount.raw, decimals: input.value.value.amount.decimals };
}

function readQuoteAmountEvidence(
  evidence: AuditEvidence | undefined,
): Readonly<{ raw: bigint; decimals: number }> | undefined {
  if (!evidence || evidence.value.kind !== "amount" || evidence.value.value.asset !== "quote") {
    return undefined;
  }
  return {
    raw: evidence.value.value.amount.raw,
    decimals: evidence.value.value.amount.decimals,
  };
}

function readDeterministic(
  attempt: ReplayAttempt<DeterministicSimulationResult>,
): DeterministicSimulationResult | undefined {
  return attempt.status === "completed" ? attempt.result : undefined;
}

function readStochastic(
  attempt: CandidateResimulationResult["stochastic"],
): StochasticSimulationResult | undefined {
  return attempt.status === "completed" && attempt.result.status !== "failed"
    ? attempt.result
    : undefined;
}

function readAttack(
  attempt: ReplayAttempt<AttackResult> | undefined,
  scenario: AttackResult["scenario"],
): Readonly<{
  result?: SuccessfulAttackResult;
  status: HardeningComparisonStatus;
  reference?: string;
  reason?: string;
}> {
  if (!attempt) return { status: "unavailable", reason: `No ${scenario} replay was retained.` };
  if (attempt.status === "failed") {
    return { status: "unavailable", reason: attempt.failure.message };
  }
  if (attempt.result.scenario !== scenario || attempt.result.status === "failed") {
    return {
      status: "unavailable",
      reason:
        attempt.result.scenario !== scenario
          ? `Replay scenario mismatch: expected ${scenario}, received ${attempt.result.scenario}.`
          : "Attack replay returned a failed result.",
      reference: attempt.result.id,
    };
  }
  return {
    result: attempt.result,
    status: attempt.result.status === "partial" ? "partial" : "compared",
    reference: attempt.result.id,
  };
}

function fromReplayValues(
  input: Readonly<{
    id: string;
    category: HardeningComparisonCategory;
    label: string;
    unit: string;
    direction: HardeningComparisonDirection;
    source: string;
    baseline?: bigint | Decimal | HardeningComparisonValue | undefined;
    hardened?: bigint | Decimal | HardeningComparisonValue | undefined;
    baselineStatus?: HardeningComparisonStatus | undefined;
    hardenedStatus?: HardeningComparisonStatus | undefined;
    evidenceReferences: readonly (string | undefined)[];
    failures: readonly (string | undefined)[];
    selectedFindingIds?: readonly string[] | undefined;
  }>,
): HardeningMetricComparison {
  return makeMetric({
    id: input.id,
    category: input.category,
    label: input.label,
    unit: input.unit,
    direction: input.direction,
    source: input.source,
    baseline: normalizeValue(input.baseline),
    hardened: normalizeValue(input.hardened),
    status: combineStatus(input.baselineStatus, input.hardenedStatus),
    evidenceReferences: input.evidenceReferences.filter(
      (value): value is string => value !== undefined,
    ),
    selectedFindingIds: input.selectedFindingIds,
    reason:
      input.failures.find((failure) => failure !== undefined) ??
      (input.baseline === undefined || input.hardened === undefined
        ? "A comparable value is unavailable for at least one replay."
        : undefined),
  });
}

function makeMetric(
  input: Readonly<{
    id: string;
    category: HardeningComparisonCategory;
    label: string;
    unit: string;
    direction: HardeningComparisonDirection;
    source: string;
    baseline?: HardeningComparisonValue | undefined;
    hardened?: HardeningComparisonValue | undefined;
    status: HardeningComparisonStatus;
    evidenceReferences: readonly string[];
    selectedFindingIds?: readonly string[] | undefined;
    reason?: string | undefined;
  }>,
): HardeningMetricComparison {
  const base = {
    id: input.id,
    category: input.category,
    label: input.label,
    unit: input.unit,
    direction: input.direction,
    source: input.source,
    status: input.status,
    evidenceReferences: input.evidenceReferences,
    ...(input.selectedFindingIds === undefined
      ? {}
      : { selectedFindingIds: input.selectedFindingIds }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
    ...(input.hardened === undefined ? {} : { hardened: input.hardened }),
  };
  if (input.baseline === undefined || input.hardened === undefined) return base;
  if (!compatibleValues(input.baseline, input.hardened)) {
    return {
      ...base,
      status: "unavailable",
      reason: "Baseline and hardened measurements use incompatible value units or asset scales.",
    };
  }
  if (input.baseline.kind === "boolean" && input.hardened.kind === "boolean") {
    return {
      ...base,
      ...(input.direction === "informational"
        ? {}
        : { improved: input.baseline.value === input.hardened.value }),
    };
  }
  if (input.baseline.kind === "boolean" || input.hardened.kind === "boolean") {
    return {
      ...base,
      status: "unavailable",
      reason: "Boolean state cannot be compared with a numeric measurement.",
    };
  }
  const delta = numericDelta(input.baseline, input.hardened);
  const improved =
    input.direction === "informational"
      ? undefined
      : input.direction === "preserve"
        ? delta === 0n || (Decimal.isDecimal(delta) && delta.isZero())
        : input.direction === "lower-is-better"
          ? compareValues(input.hardened, input.baseline) < 0
          : compareValues(input.hardened, input.baseline) > 0;
  return { ...base, delta, ...(improved === undefined ? {} : { improved }) };
}

function compatibleValues(
  left: HardeningComparisonValue,
  right: HardeningComparisonValue,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "amount" ||
      (right.kind === "amount" && left.asset === right.asset && left.decimals === right.decimals))
  );
}

function numericDelta(
  baseline: HardeningComparisonValue,
  hardened: HardeningComparisonValue,
): bigint | Decimal {
  if (baseline.kind === "decimal" && hardened.kind === "decimal") {
    return hardened.value.minus(baseline.value);
  }
  if (baseline.kind === "amount" && hardened.kind === "amount") return hardened.raw - baseline.raw;
  if (baseline.kind === "basis-points" && hardened.kind === "basis-points") {
    return hardened.value - baseline.value;
  }
  if (baseline.kind === "count" && hardened.kind === "count")
    return hardened.value - baseline.value;
  return 0n;
}

function compareValues(left: HardeningComparisonValue, right: HardeningComparisonValue): number {
  const leftRaw = valueToComparable(left);
  const rightRaw = valueToComparable(right);
  if (Decimal.isDecimal(leftRaw) && Decimal.isDecimal(rightRaw))
    return leftRaw.comparedTo(rightRaw);
  if (typeof leftRaw === "bigint" && typeof rightRaw === "bigint") {
    return leftRaw < rightRaw ? -1 : leftRaw > rightRaw ? 1 : 0;
  }
  return 0;
}

function valueToComparable(value: HardeningComparisonValue): bigint | Decimal {
  switch (value.kind) {
    case "amount":
    case "count":
      return value.kind === "amount" ? value.raw : value.value;
    case "basis-points":
      return value.value;
    case "decimal":
      return value.value;
    case "boolean":
      return value.value ? 1n : 0n;
  }
}

function normalizeValue(
  value: bigint | Decimal | HardeningComparisonValue | undefined,
): HardeningComparisonValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return bpsValue(value);
  if (Decimal.isDecimal(value)) return decimalValue(value);
  return value;
}

function amountValue(
  asset: "base" | "quote",
  raw: bigint,
  decimals: number,
): HardeningComparisonValue {
  return { kind: "amount", asset, raw, decimals };
}

function bpsValue(value: bigint): HardeningComparisonValue {
  return { kind: "basis-points", value };
}

function bpsDecimalValue(value: Decimal): HardeningComparisonValue {
  return { kind: "decimal", value };
}

function decimalValue(value: Decimal): HardeningComparisonValue {
  return { kind: "decimal", value };
}

function countValue(value: number | bigint): HardeningComparisonValue {
  return { kind: "count", value: BigInt(value) };
}

function booleanValue(value: boolean): HardeningComparisonValue {
  return { kind: "boolean", value };
}

function combineStatus(
  baseline: HardeningComparisonStatus | undefined,
  hardened: HardeningComparisonStatus | undefined,
): HardeningComparisonStatus {
  if (baseline === undefined || hardened === undefined) return "unavailable";
  if (baseline === "unavailable" || hardened === "unavailable") return "unavailable";
  if (baseline === "partial" || hardened === "partial") return "partial";
  return "compared";
}

function deterministicStatus(
  attempt: ReplayAttempt<DeterministicSimulationResult>,
): HardeningComparisonStatus {
  if (attempt.status === "failed") return "unavailable";
  return attempt.result.status === "partial" ? "partial" : "compared";
}

function stochasticStatus(
  attempt: CandidateResimulationResult["stochastic"],
): HardeningComparisonStatus {
  if (attempt.status === "failed" || attempt.result.status === "failed") return "unavailable";
  return attempt.result.status === "partial" ? "partial" : "compared";
}

function attemptFailure(
  attempt:
    | ReplayAttempt<DeterministicSimulationResult>
    | CandidateResimulationResult["stochastic"]
    | ReplayAttempt<AttackResult>,
): string | undefined {
  if (attempt.status === "failed") return attempt.failure.message;
  if ("status" in attempt.result && attempt.result.status === "failed") {
    return "Simulation or attack returned a failed result.";
  }
  return undefined;
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  const delta = left - right;
  return delta < 0n ? -delta : delta;
}

function relativeErrorBps(actual: Decimal, target: Decimal): Decimal {
  const preciseActual = new ExactDecimal(actual.toFixed());
  const preciseTarget = new ExactDecimal(target.toFixed());
  return new Decimal(
    preciseActual.minus(preciseTarget).abs().div(preciseTarget).mul(BASIS_POINTS).toFixed(),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateInput(
  generation: HardenedCandidateGenerationResult,
  resimulation: HardeningResimulationResult,
): void {
  if (typeof generation !== "object" || generation === null || Array.isArray(generation)) {
    throw new TypeError("Hardened candidate generation result is required");
  }
  if (generation.status === "unsatisfied" || !generation.hardenedCandidate) {
    throw new TypeError("A generated hardened candidate is required for comparison");
  }
  if (typeof resimulation !== "object" || resimulation === null || Array.isArray(resimulation)) {
    throw new TypeError("Hardening resimulation result is required");
  }
  if (
    resimulation.originalCandidateId !== generation.originalCandidate.id ||
    resimulation.hardenedCandidateId !== generation.hardenedCandidate.id ||
    resimulation.baseline.candidateId !== generation.originalCandidate.id ||
    resimulation.hardened.candidateId !== generation.hardenedCandidate.id
  ) {
    throw new RangeError(
      "Hardening comparison candidate identities do not match the generation result",
    );
  }
}
