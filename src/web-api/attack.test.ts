import { describe, expect, it } from "vitest";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };
import compile from "../../examples/demo-compile-request.json" with { type: "json" };
import { attackWebDocument } from "./attack.js";
import { compileWebDocument } from "./compile.js";

describe("web attack workflow", { timeout: 15_000 }, () => {
  it("uses only completed samples when seeded outcomes are mixed", () => {
    const candidateId = compileWebDocument(compile).candidates[0]?.id;
    const configuration = structuredClone(fixture.attacks["opening-sniper"]);
    configuration.requestedIterations = "10";
    configuration.ticks.tickCount = "3";
    configuration.supportingAgentDistribution.templates["retail-buyer"].buyProbabilityBps = "2500";
    const request = {
      compileRequest: compile,
      candidateId,
      scenario: "opening-sniper",
      configuration,
    };
    const result = attackWebDocument(request);
    expect(result).toMatchObject({
      status: "partial",
      summary: { completed: "5", partial: "5", requested: "10", seed: "73" },
    });
    expect(result.measurements?.length).toBeGreaterThan(0);
    expect(result).toEqual(attackWebDocument(request));
  });
  it("retains incomplete iterations without fabricated measurements", () => {
    const candidateId = compileWebDocument(compile).candidates[0]?.id;
    const configuration = {
      ...fixture.attacks["opening-sniper"],
      ticks: { tickCount: "1", slotsPerTick: "1", secondsPerTick: "1" },
    };
    const result = attackWebDocument({
      compileRequest: compile,
      candidateId,
      scenario: "opening-sniper",
      configuration,
    });
    expect(result).toMatchObject({
      status: "failed",
      metrics: null,
      measurements: [],
      summary: { completed: "0", partial: "1", failed: "0", requested: "1", seed: "73" },
    });
    expect(result.snapshot).toBeDefined();
  });
  it("runs all five models on the selected draft and preserves reproducibility", () => {
    const {
      schemaVersion: _schema,
      preScenarioBuyQuoteAtomic: warmupQuoteAtomic,
      attacks,
      ...compileRequest
    } = fixture;
    const candidates = compileWebDocument(compileRequest).candidates;
    const candidateId = candidates[1]?.id;
    expect(candidateId).toBeDefined();
    for (const scenario of Object.keys(attacks) as (keyof typeof attacks)[]) {
      const request = {
        compileRequest,
        candidateId,
        scenario,
        configuration: attacks[scenario],
        warmupQuoteAtomic,
      };
      const result = attackWebDocument(request);
      expect(["completed", "partial", "failed"]).toContain(result.status);
      if (result.status === "failed") expect(result.metrics).toBeNull();
      expect(result.candidateId).toBe(candidateId);
      expect(result.snapshot).toBeDefined();
      expect(result).toEqual(attackWebDocument(request));
    }
  });
  it("rejects unknown drafts, numeric amounts, oversized workloads, and unsupported fixed-fee timing", () => {
    const candidateId = compileWebDocument(compile).candidates[0]?.id;
    const request = {
      compileRequest: compile,
      candidateId,
      scenario: "opening-sniper",
      configuration: fixture.attacks["opening-sniper"],
    };
    expect(attackWebDocument({ ...request, candidateId: "forged" }).status).toBe("failed");
    expect(
      attackWebDocument({ ...request, configuration: { ...request.configuration, randomSeed: 73 } })
        .status,
    ).toBe("failed");
    expect(
      attackWebDocument({
        ...request,
        configuration: { ...request.configuration, requestedIterations: "1000" },
      }).status,
    ).toBe("failed");
    expect(
      attackWebDocument({
        ...request,
        scenario: "fee-schedule-timing",
        configuration: fixture.attacks["fee-schedule-timing"],
      }).status,
    ).toBe("unsupported");
  });
});
