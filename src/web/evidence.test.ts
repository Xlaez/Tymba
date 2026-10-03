import { describe, expect, it } from "vitest";
import type { WebHardeningResponse } from "../web-api/contracts.js";
import { comparisonAssessment, evidenceNotices } from "./evidence.js";

describe("stage-specific evidence limits", () => {
  it.each([
    ["workspace", "No wallet signing, deployment, or on-chain verification"],
    ["review", "does not prove economic feasibility"],
    ["compile", "does not mean buyers will arrive or capital will be raised"],
    ["curve", "not time or expected demand"],
    ["simulation", "does not prove on-chain DAMM migration"],
    ["attack", "sample percentiles are not future bounds"],
    ["audit", "LOW does not mean safe; unavailable evidence is not zero risk"],
    ["hardening", "completed run may show no improvement or worse metrics"],
  ] as const)("qualifies %s evidence", (stage, limitation) => {
    expect(evidenceNotices[stage].title).not.toBe("");
    expect(evidenceNotices[stage].text).toContain(limitation);
  });
});

describe("hardening assessment scope", () => {
  const metric: WebHardeningResponse["metrics"][number] = {
    id: "sniper-return",
    label: "Sniper return",
    unit: "bps",
    direction: "lower-is-better",
    status: "compared",
    baseline: "251",
    hardened: "199",
    delta: "-52",
    improved: true,
    references: ["baseline-attack", "hardened-attack"],
    reason: "Paired explicit seeds.",
  };

  it("limits an improvement to tested inputs", () => {
    expect(comparisonAssessment(metric)).toBe("improved under tested inputs only");
  });

  it("does not call unchanged or worse metrics improved", () => {
    expect(comparisonAssessment({ ...metric, hardened: "251", delta: "0", improved: false })).toBe(
      "not improved under tested inputs only",
    );
    expect(comparisonAssessment({ ...metric, hardened: "260", delta: "9", improved: false })).toBe(
      "not improved under tested inputs only",
    );
  });

  it("limits partial comparisons to available evidence", () => {
    expect(comparisonAssessment({ ...metric, status: "partial" })).toBe(
      "improved in available partial evidence only",
    );
    expect(comparisonAssessment({ ...metric, status: "partial", improved: false })).toBe(
      "not improved in available partial evidence only",
    );
  });

  it.each(["unavailable", "failed", "unknown"])("never assesses %s evidence", (status) => {
    expect(comparisonAssessment({ ...metric, status })).toBe("no improvement assessment");
  });

  it.each([
    "baseline",
    "hardened",
    "delta",
    "improved",
  ] as const)("does not assess missing %s", (key) => {
    expect(comparisonAssessment({ ...metric, [key]: null })).toBe("no improvement assessment");
  });
});
