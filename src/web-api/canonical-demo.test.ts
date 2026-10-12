import { describe, expect, it } from "vitest";
import attackFixture from "../../examples/demo-attack-request.json" with { type: "json" };
import canonicalSniper from "../../examples/demo-canonical-sniper.json" with { type: "json" };
import compileRequest from "../../examples/demo-compile-request.json" with { type: "json" };
import deploymentRecord from "../../examples/devnet-deployment-record.demo-v1.json" with {
  type: "json",
};
import { attackWebDocument } from "./attack.js";
import { auditWebDocument } from "./audit.js";
import { compileWebDocument } from "./compile.js";
import { hardenWebDocument } from "./harden.js";

const DEPLOYED_DRAFT_ID = "curve-quote-69618739077-80381260922-1";
const HARDENED_DRAFT_ID = "curve-quote-84293029902-1-65706970097";

const trades = [
  { direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" },
  { direction: "buy", amount: "10000", slot: "2", timestampSeconds: "2" },
  { direction: "sell", amount: "1000000", slot: "3", timestampSeconds: "3" },
];

const opening = canonicalSniper;
const stochasticReplay = {
  id: "web-reference-stochastic",
  randomSeed: attackFixture.attacks["opening-sniper"].randomSeed,
  requestedIterations: attackFixture.attacks["opening-sniper"].requestedIterations,
  agentDistribution: attackFixture.attacks["opening-sniper"].supportingAgentDistribution,
  ticks: { ...attackFixture.attacks["opening-sniper"].ticks, executionOrder: "configured" },
};

function attackRequests() {
  return [
    {
      compileRequest,
      candidateId: DEPLOYED_DRAFT_ID,
      scenario: "opening-sniper",
      configuration: opening,
    },
    {
      compileRequest,
      candidateId: DEPLOYED_DRAFT_ID,
      scenario: "pump-and-dump",
      configuration: attackFixture.attacks["pump-and-dump"],
    },
  ];
}

function auditRequest() {
  return { compileRequest, candidateId: DEPLOYED_DRAFT_ID, trades, attacks: attackRequests() };
}

function metricsOf(response: ReturnType<typeof attackWebDocument> | undefined) {
  return (response?.metrics ?? {}) as Record<string, unknown>;
}

function p95Raw(value: unknown): string {
  const metric = value as { p95: { amount: { raw: string } } };
  return metric.p95.amount.raw;
}

describe("canonical seeded demo", { timeout: 60_000 }, () => {
  it("compiles the deployed Devnet curve as the second ranked draft", () => {
    const compiled = compileWebDocument(compileRequest);
    expect(compiled.candidates.map(({ id }) => id).slice(0, 3)).toEqual([
      "curve-quote-69618739076-80381260923-1",
      DEPLOYED_DRAFT_ID,
      HARDENED_DRAFT_ID,
    ]);
    const deployed = compiled.candidates[1];
    expect(deployed?.rank).toBe(2);
    expect(deployed?.baseDistributionPct).toBe("25");
    expect(deployed?.advanced?.migrationQuoteThresholdAtomic).toBe("150000000000");
    const onChain = deploymentRecord.candidate.deployedParameters;
    expect(deployed?.advanced?.startSqrtPriceQ64x64).toBe(onChain.sqrtStartPriceQ64x64);
    expect(
      deployed?.advanced?.segments.map(({ upperSqrtPriceQ64x64, liquidity }) => ({
        sqrtPriceQ64x64: upperSqrtPriceQ64x64,
        liquidity,
      })),
    ).toEqual(onChain.curve);
  });

  it("exposes modeled sniper and pump-and-dump risk with pinned seeds and repeats exactly", () => {
    const [sniper, pump] = attackRequests().map((request) => attackWebDocument(request));
    expect(sniper?.status).toBe("completed");
    expect(p95Raw(metricsOf(sniper).attackerPnlQuote)).toBe("14234231");
    expect(pump?.status).toBe("completed");
    expect(p95Raw(metricsOf(pump).attackerPnlQuote)).toBe("422367006");
    expect((metricsOf(pump).peakToTroughDrawdownBps as { p95: string }).p95).toBe("2397");
    expect((metricsOf(pump).lateBuyerLossBps as { p95: string }).p95).toBe("2226");
    expect(p95Raw(metricsOf(pump).recoveryQuoteRequired)).toBe("10474674916");
    const repeat = attackRequests().map((request) => attackWebDocument(request));
    expect(JSON.stringify(repeat)).toBe(JSON.stringify([sniper, pump]));
  });

  it("assigns the documented demo-v1 severities to the retained evidence", () => {
    const audit = auditWebDocument(auditRequest());
    if (audit.status === "failed") throw new Error(audit.message);
    const severity = (suffix: string) =>
      audit.categories.flatMap(({ findings }) => findings).find(({ id }) => id.endsWith(suffix))
        ?.severity;
    expect(severity("price-stability.early-impact")).toBe("HIGH");
    expect(severity("price-stability.mid-impact")).toBe("HIGH");
    expect(severity("sniper-exposure.opening-attacker-profit-p95")).toBe("MODERATE");
    expect(severity("exit-liquidity.pump-and-dump-drawdown-p95")).toBe("MODERATE");
    expect(severity("exit-liquidity.opening-sniper-drawdown-p95")).toBe("LOW");
  });

  it("hardening lowers the modeled sniper return without changing the original targets", () => {
    const input = auditRequest();
    const audit = auditWebDocument(input);
    if (audit.status === "failed") throw new Error(audit.message);
    const finding = audit.categories
      .flatMap(({ findings }) => findings)
      .find(({ id }) => id.endsWith("sniper-exposure.opening-attacker-profit-p95"));
    if (!finding) throw new Error("Expected the opening-sniper finding");
    const result = hardenWebDocument({
      auditRequest: input,
      findingIds: [finding.id],
      riskWeights: { earlyPriceImpact: "0", attackProfitability: "0.3" },
      stochasticReplay,
    });
    expect(result.status, result.message).toBe("completed");
    expect(result.originalCandidateId).toBe(DEPLOYED_DRAFT_ID);
    expect(result.hardenedCandidateId).toBe(HARDENED_DRAFT_ID);
    const metric = (label: string) => result.metrics.find((entry) => entry.label === label);
    const sniperProfit = metric("Opening-sniper p95 signed profit");
    expect([sniperProfit?.baseline, sniperProfit?.hardened, sniperProfit?.delta]).toEqual([
      "14234231",
      "11601056",
      "-2633175",
    ]);
    const sniperReturn = metric("Selected opening-sniper return replay");
    expect([sniperReturn?.baseline, sniperReturn?.hardened, sniperReturn?.delta]).toEqual([
      "711",
      "580",
      "-131",
    ]);
    const impact = metric("Maximum single-trade price impact");
    expect([impact?.baseline, impact?.hardened, impact?.delta]).toEqual(["2852", "2359", "-493"]);
    for (const label of [
      "Absolute quote-target error",
      "Absolute base-distribution target error",
    ]) {
      expect([metric(label)?.baseline, metric(label)?.hardened]).toEqual(["0", "0"]);
    }
    expect(metric("Curve-completion simulation reached migration")?.hardened).toBe("false");
  });
});
