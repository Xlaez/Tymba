import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { createDemoPoolState, createDemoSimulationInput } from "../../examples/demo-market.js";
import { currencyAmount } from "./currency-amount.js";
import { DEMO_AUDIT_SEVERITY_POLICY } from "./audit-policy.js";
import { createAuditFinding } from "./audit-finding.js";
import { validateMarketIntent } from "./market-intent.js";
import { runDeterministicSimulation } from "./simulator.js";
import { analyzePriceStability } from "./price-stability-audit.js";
import type { SolverObjectiveWeights } from "./solver-objective.js";
import { convertAuditFindingsToSolverObjective } from "./audit-solver-objective.js";

const originalWeights: SolverObjectiveWeights = {
  quoteError: new Decimal("0.3"),
  distributionError: new Decimal("0.3"),
  migrationPriceError: new Decimal("0.1"),
  earlyPriceImpact: new Decimal("0.1"),
  attackProfitability: new Decimal("0.1"),
  complexity: new Decimal("0.1"),
};

function getMarket() {
  const result = validateMarketIntent({
    assets: {
      base: { symbol: "MKT", decimals: 9 },
      quote: { symbol: "USDC", decimals: 6 },
    },
    supply: { totalBase: "1000000000" },
    pricing: { startPrice: "0.0002", migrationPrice: "0.002" },
    targets: { quoteToMigration: "150000", baseDistributionPct: "25" },
    preferences: { maxEarlyPriceImpactPct: "3" },
    solver: { maxSegments: 3 },
  });
  if (result.status === "invalid") throw new Error("Expected valid normalized market intent");
  return result.normalized;
}

function makeSniperFinding() {
  return createAuditFinding({
    auditId: "hardening-source-audit",
    policy: DEMO_AUDIT_SEVERITY_POLICY,
    observation: {
      category: "sniper-exposure",
      ruleId: "sniper-exposure.opening-attacker-profit-p95",
      source: "adversarial-simulation",
      reference: "opening-sniper-run-1",
      metric: "sniper-return-bps",
      valueBps: 2_000n,
      metricDescription: "p95 modeled return on explicit quote capital-at-risk",
      supportingEvidence: [
        {
          source: "adversarial-simulation",
          reference: "opening-sniper-run-1",
          metric: "p95 attacker quote PnL (signed quote amount)",
          value: {
            kind: "amount",
            value: { asset: "quote", amount: currencyAmount(200n, 6) },
          },
        },
        {
          source: "adversarial-simulation",
          reference: "opening-sniper-run-1",
          metric: "explicit opening attack capital-at-risk basis (quote amount)",
          value: {
            kind: "amount",
            value: { asset: "quote", amount: currencyAmount(1_000n, 6) },
          },
        },
      ],
    },
    title: "Opening-sniper profitability",
    explanation: "Test fixture for solver mapping.",
    remediation: "Adjust early liquidity; trade-off: capital allocation changes.",
  });
}

describe("audit-driven solver objective conversion", () => {
  it("maps raw early-impact and sniper-return findings to compatible objective penalties", () => {
    const simulation = runDeterministicSimulation({
      id: "hardening-source-deterministic-run",
      initialState: createDemoPoolState(),
      trades: [{ direction: "buy", inputAtomic: 5_000_000_000n }],
    });
    const audit = analyzePriceStability({
      auditId: "hardening-source-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });
    const earlyImpactFinding = audit.findings.find(
      ({ ruleId }) => ruleId === "price-stability.early-impact",
    );
    if (!earlyImpactFinding) throw new Error("Expected early-impact finding");
    const sniperFinding = makeSniperFinding();
    const result = convertAuditFindingsToSolverObjective({
      originalWeights,
      findings: [earlyImpactFinding, sniperFinding],
      market: getMarket(),
      addedRiskWeights: {
        earlyPriceImpact: new Decimal("0.2"),
        attackProfitability: new Decimal("0.1"),
      },
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
    });

    expect(result.status).toBe("converted");
    expect(result.mappings.map(({ objectiveTerm }) => objectiveTerm)).toEqual([
      "earlyPriceImpact",
      "attackProfitability",
    ]);
    expect(result.mappings[0]?.rawMetricValueBps).toBe(earlyImpactFinding.severityValueBps);
    expect(result.mappings[0]?.objectiveTargetBps).toBe(300n);
    expect(result.mappings[0]?.objectiveTargetSource).toBe("original-intent");
    expect(result.mappings[0]?.objectiveFormula).not.toContain("severity");
    expect(result.mappings[1]?.rawMetricValueBps).toBe(2_000n);
    expect(result.objectiveWeights?.earlyPriceImpact.toFixed()).toBe("0.27");
    expect(result.objectiveWeights?.attackProfitability.toFixed()).toBe("0.17");
    expect(result.objectiveWeights?.quoteError.toFixed()).toBe("0.21");
    expect(result.requiredEvaluators).toEqual([
      "earlyPriceImpactEvaluator",
      "attackExposureEvaluator",
    ]);
  });

  it("keeps unsupported audit metrics visible instead of approximating them", () => {
    const simulation = runDeterministicSimulation({
      ...createDemoSimulationInput(),
      id: "unsupported-hardening-run",
    });
    const audit = analyzePriceStability({
      auditId: "unsupported-hardening-audit",
      candidateId: "demo-candidate",
      deterministicRuns: [simulation],
    });
    const drawdownFinding = audit.findings.find(
      ({ ruleId }) => ruleId === "price-stability.maximum-drawdown",
    );
    if (!drawdownFinding) throw new Error("Expected drawdown finding");
    const result = convertAuditFindingsToSolverObjective({
      originalWeights,
      findings: [drawdownFinding],
      market: getMarket(),
      addedRiskWeights: { earlyPriceImpact: new Decimal("0.2") },
      earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
    });

    expect(result.status).toBe("unsupported");
    expect(result.objectiveWeights).toBeUndefined();
    expect(result.unsupportedFindings[0]?.findingId).toBe(drawdownFinding.id);
    expect(result.unsupportedFindings[0]?.reason).toContain("without changing its meaning");
    expect(result.unsupportedRiskTerms).toEqual([
      expect.objectContaining({ term: "earlyPriceImpact" }),
    ]);
  });

  it("requires risk weights to leave positive weight for the original economic objectives", () => {
    expect(() =>
      convertAuditFindingsToSolverObjective({
        originalWeights,
        findings: [],
        market: getMarket(),
        addedRiskWeights: { earlyPriceImpact: new Decimal(1) },
        earlyPriceImpactProbeQuoteAtomic: 5_000_000_000n,
      }),
    ).toThrow("sum to less than one");
  });
});
