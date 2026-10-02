import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDocument, formatCompileReport } from "./compile.js";
import { serializeCliJson } from "./output.js";

function readExample(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("CLI compilation gate", () => {
  it("blocks a MarketIntent-only file without inventing solver defaults", () => {
    const report = compileDocument(readExample("demo-market.json"));

    expect(report.status).toBe("blocked");
    expect(report.failure.code).toBe("explicit_solver_configuration_required");
    expect(report.deployableCandidates).toHaveLength(0);
    expect(report.draftCandidates).toHaveLength(0);
    expect(report.failure.message).toContain("will not invent defaults");
  });

  it("simulates and SDK-validates drafts but never emits an unvalidated configuration", () => {
    const report = compileDocument(readExample("demo-compile-request.json"));

    expect(report.command).toBe("compile");
    expect(report.status).toBe("blocked");
    expect(report.solverStatus).toBe("satisfied");
    expect(report.draftCandidates.length).toBeGreaterThan(0);
    expect(report.deployableCandidates).toHaveLength(0);
    expect(
      report.draftCandidates.every((candidate) => candidate.verificationStatus === "unverified"),
    ).toBe(true);
    expect(
      report.draftCandidates.every(
        (candidate) =>
          candidate.simulation.metrics.quoteAccumulated.amount.raw ===
          candidate.metrics.quoteToMigration.raw,
      ),
    ).toBe(true);
    expect(
      report.draftCandidates.every(
        (candidate) => candidate.sdkCurveValidation.sdkVersion === "1.5.13",
      ),
    ).toBe(true);
    expect(report.failure.code).toBe("full_configuration_validation_pending");
    expect(formatCompileReport(report)).toContain("Deployable candidates: 0");
    const jsonReport = JSON.parse(serializeCliJson(report)) as {
      status: string;
      deployableCandidates: readonly unknown[];
      draftCandidates: readonly { curve: { segments: readonly { liquidity: string }[] } }[];
    };
    expect(jsonReport.status).toBe("blocked");
    expect(jsonReport.deployableCandidates).toHaveLength(0);
    expect(typeof jsonReport.draftCandidates[0]?.curve.segments[0]?.liquidity).toBe("string");
  });

  it("rejects numeric objective weights at the JSON boundary", () => {
    const request = readExample("demo-compile-request.json") as {
      objectiveWeights: Record<string, unknown>;
    };
    const report = compileDocument({
      ...request,
      objectiveWeights: { ...request.objectiveWeights, quoteError: 0.35 },
    });

    expect(report.status).toBe("failed");
    expect(report.deployableCandidates).toHaveLength(0);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "$.objectiveWeights.quoteError",
        code: "invalid_objective_weight",
      }),
    );
  });
});
