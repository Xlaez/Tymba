import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDocument } from "../cli/compile.js";
import { compileWebDocument } from "./compile.js";

function request() {
  return JSON.parse(
    readFileSync(new URL("../../examples/demo-compile-request.json", import.meta.url), "utf8"),
  );
}

describe("web compile projection", () => {
  it("ranks three reproducible draft previews from quantized CLI metrics without promoting verification", () => {
    const input = request();
    const result = compileWebDocument(input);
    const cli = compileDocument(input);
    expect(result.solverStatus).toBe("satisfied");
    expect(result.candidates).toHaveLength(3);
    expect(result.deployableCandidateCount).toBe(0);
    expect(result).toEqual(compileWebDocument(input));
    for (const candidate of result.candidates) {
      const source = cli.draftCandidates.find(({ id }) => id === candidate.id);
      expect(source).toBeDefined();
      expect(candidate.objectiveScore).toBe(source?.objectiveScore.toFixed());
      expect(candidate.verificationStatus).toBe("unverified");
      expect(candidate.advanced?.totalBaseAtomic).toBe("1000000000000000000");
      expect(candidate.advanced?.startSqrtPriceQ64x64).toBe(
        source?.curve.startSqrtPriceQ64x64.toString(),
      );
      expect(candidate.advanced?.segments.map((segment) => segment.liquidity)).toEqual(
        source?.curve.segments.map((segment) => segment.liquidity.toString()),
      );
      expect(JSON.parse(JSON.stringify(candidate.advanced))).toEqual(candidate.advanced);
      expect(candidate.segments).toHaveLength(source?.curve.segments.length ?? 0);
      expect(candidate.segments[0]?.points[0]?.quote).toBe("0");
      expect(candidate.segments.at(-1)?.points.at(-1)?.quote).toBe(candidate.quoteToMigration);
      for (const segment of candidate.segments) {
        const evidence = source?.explanations.find(
          (entry) => entry.segmentIndex === segment.index,
        )?.evidence;
        expect(segment.lowerPrice).toBe(evidence?.lowerPrice.toFixed());
        expect(segment.upperPrice).toBe(evidence?.upperPrice.toFixed());
        expect(segment.points[0]?.price).toBe(segment.lowerPrice);
        expect(segment.points.at(-1)?.price).toBe(segment.upperPrice);
      }
    }
    expect(result.warnings.join(" ")).toContain("not optimized or enforced");
  });
  it("surfaces unsatisfied, partial, and invalid input with no invented candidates", () => {
    const input = request();
    input.marketIntent.targets.quoteToMigration = "0.000001";
    const unsatisfied = compileWebDocument(input);
    expect(unsatisfied.solverStatus).toBe("unsatisfied");
    expect(unsatisfied.candidates).toEqual([]);
    input.marketIntent.targets.quoteToMigration = "150000";
    input.marketIntent.targets.baseDistributionPct = "60";
    const partial = compileWebDocument(input);
    expect(partial.solverStatus).toBe("partial");
    expect(partial.candidates.some(({ conflicts }) => conflicts.length > 0)).toBe(true);
    expect(partial.candidates[0]?.conflicts[0]?.alternatives?.[0]?.suggestedValue).toBeDefined();
    input.objectiveWeights.quoteError = 0.35;
    expect(compileWebDocument(input).candidates).toEqual([]);
  });
});
