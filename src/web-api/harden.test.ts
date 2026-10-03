import { describe, expect, it } from "vitest";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };
import compileRequest from "../../examples/demo-compile-request.json" with { type: "json" };
import { auditWebDocument } from "./audit.js";
import { compileWebDocument } from "./compile.js";
import { hardenWebDocument } from "./harden.js";

const opening = fixture.attacks["opening-sniper"];
const stochasticReplay = {
  id: "web-test-population",
  randomSeed: opening.randomSeed,
  requestedIterations: opening.requestedIterations,
  agentDistribution: opening.supportingAgentDistribution,
  ticks: { ...opening.ticks, executionOrder: "configured" },
};
function request() {
  const candidateId = compileWebDocument(compileRequest).candidates[0]?.id;
  const auditRequest = {
    compileRequest,
    candidateId,
    trades: [{ direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" }],
    attacks: [{ compileRequest, candidateId, scenario: "opening-sniper", configuration: opening }],
  };
  const audit = auditWebDocument(auditRequest);
  if (audit.status === "failed") throw new Error(audit.message);
  const finding = audit.categories.find((category) => category.category === "sniper-exposure")
    ?.findings[0];
  if (!finding) throw new Error("Expected sniper evidence.");
  return {
    auditRequest,
    findingIds: [finding.id],
    riskWeights: { attackProfitability: "0.3", earlyPriceImpact: "0" },
    stochasticReplay,
  };
}
describe("web hardening", { timeout: 15_000 }, () => {
  it("retains partial attack outcomes in the paired comparison", () => {
    const input = request();
    const configuration = structuredClone(opening);
    configuration.requestedIterations = "10";
    configuration.ticks.tickCount = "3";
    configuration.supportingAgentDistribution.templates["retail-buyer"].buyProbabilityBps = "2500";
    const auditRequest = {
      ...input.auditRequest,
      attacks: input.auditRequest.attacks.map((attack) => ({ ...attack, configuration })),
    };
    const audit = auditWebDocument(auditRequest);
    if (audit.status === "failed") throw new Error(audit.message);
    const finding = audit.categories.find((category) => category.category === "sniper-exposure")
      ?.findings[0];
    if (!finding) throw new Error("Expected completed partial-run samples.");
    const result = hardenWebDocument({ ...input, auditRequest, findingIds: [finding.id] });
    expect(result.status, result.message).toBe("partial");
    expect(result.metrics.find((metric) => metric.id.startsWith("attack-0"))?.status).toBe(
      "partial",
    );
    expect(result.snapshot).toBeDefined();
  });
  it("preserves target economics and replays retained deterministic, stochastic and attack evidence", () => {
    const input = request();
    const result = hardenWebDocument(input);
    expect(result.status, result.message).toBe("completed");
    expect(result.originalCandidateId).toBe(input.auditRequest.candidateId);
    expect(result.metrics.find((metric) => metric.id === "quote-target-error")).toMatchObject({
      baseline: "0",
      hardened: "0",
    });
    expect(
      result.metrics.find((metric) => metric.id === "base-distribution-target-error"),
    ).toMatchObject({ baseline: "0", hardened: "0" });
    expect(
      result.metrics.find((metric) => metric.id === `selected-risk-${input.findingIds[0]}`)?.status,
    ).toBe("compared");
    expect(JSON.stringify(result.snapshot)).toContain('"randomSeed":"73"');
    expect(result).toEqual(hardenWebDocument(input));
  });
  it("rejects forged findings, absent scripts, numeric weights, and unsupported objective selections", () => {
    const input = request();
    expect(hardenWebDocument({ ...input, findingIds: ["forged"] }).status).toBe("failed");
    expect(hardenWebDocument({ ...input, riskWeights: { attackProfitability: 0.3 } }).status).toBe(
      "failed",
    );
    const { trades: _trades, ...auditRequest } = input.auditRequest;
    expect(hardenWebDocument({ ...input, auditRequest }).status).toBe("failed");
    expect(hardenWebDocument({ ...input, riskWeights: { earlyPriceImpact: "0.3" } }).status).toBe(
      "unsatisfied",
    );
    const tooLarge = { ...stochasticReplay, requestedIterations: "11" };
    expect(hardenWebDocument({ ...input, stochasticReplay: tooLarge }).status).toBe("failed");
    expect(
      hardenWebDocument({
        ...input,
        stochasticReplay: {
          ...stochasticReplay,
          ticks: { ...stochasticReplay.ticks, secondsPerTick: "0" },
        },
      }).status,
    ).toBe("failed");
  });
});
