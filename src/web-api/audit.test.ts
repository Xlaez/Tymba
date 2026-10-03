import { describe, expect, it } from "vitest";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };
import compileRequest from "../../examples/demo-compile-request.json" with { type: "json" };
import { DEMO_AUDIT_SEVERITY_POLICY } from "../domain/audit-policy.js";
import { jsonSnapshot } from "./attack.js";
import { auditWebDocument } from "./audit.js";
import { compileWebDocument } from "./compile.js";

describe("web audit", { timeout: 15_000 }, () => {
  it("retains raw metrics, actual source evidence and demo policy, and never fills missing categories with zero risk", () => {
    const candidateId = compileWebDocument(compileRequest).candidates[0]?.id;
    const request = {
      compileRequest,
      candidateId,
      trades: [{ direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" }],
      attacks: [
        {
          compileRequest,
          candidateId,
          scenario: "opening-sniper",
          configuration: fixture.attacks["opening-sniper"],
        },
      ],
    };
    const result = auditWebDocument(request);
    expect(result.status).toBe("partial");
    if (result.status === "failed") throw new Error(result.message);
    expect(result.policy).toEqual(jsonSnapshot(DEMO_AUDIT_SEVERITY_POLICY));
    expect(result.categories).toHaveLength(9);
    expect(
      result.categories
        .find((category) => category.category === "sniper-exposure")
        ?.findings[0]?.evidence.join(" "),
    ).toContain("capital-at-risk");
    expect(
      result.categories.find((category) => category.category === "migration-fragility"),
    ).toMatchObject({ status: "unavailable", findings: [] });
    expect(result).toEqual(auditWebDocument(request));
  });
  it("rejects forged sources and requires new identity for edited policy", () => {
    const candidateId = compileWebDocument(compileRequest).candidates[0]?.id;
    expect(
      auditWebDocument({
        compileRequest,
        candidateId,
        attacks: [
          {
            compileRequest,
            candidateId: "forged",
            scenario: "opening-sniper",
            configuration: fixture.attacks["opening-sniper"],
          },
        ],
      }).status,
    ).toBe("failed");
    const policy = JSON.parse(JSON.stringify(jsonSnapshot(DEMO_AUDIT_SEVERITY_POLICY)));
    policy.thresholds["early-price-impact-bps"].moderateAtOrAboveBps = "1";
    expect(auditWebDocument({ compileRequest, candidateId, attacks: [], policy }).status).toBe(
      "failed",
    );
    policy.version = "custom-v1";
    expect(auditWebDocument({ compileRequest, candidateId, attacks: [], policy }).status).toBe(
      "partial",
    );
    const original = jsonSnapshot(DEMO_AUDIT_SEVERITY_POLICY);
    const reordered = Object.fromEntries(
      Object.entries(original as Record<string, unknown>).reverse(),
    );
    expect(
      auditWebDocument({ compileRequest, candidateId, attacks: [], policy: reordered }).status,
    ).toBe("partial");
  });
});
