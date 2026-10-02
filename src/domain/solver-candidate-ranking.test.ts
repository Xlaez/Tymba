import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { rankSolverCandidates, type RankableSolverCandidate } from "./solver-candidate-ranking.js";

function candidate(
  id: string,
  score: string,
  verificationStatus: RankableSolverCandidate["verificationStatus"] = "sdk-validated",
): RankableSolverCandidate {
  return { id, objectiveScore: new Decimal(score), verificationStatus };
}

describe("rankSolverCandidates", () => {
  it("returns the top three SDK-validated candidates in deterministic score order", () => {
    const result = rankSolverCandidates([
      candidate("candidate-c", "0.3"),
      candidate("candidate-u", "0", "unverified"),
      candidate("candidate-b", "0.2", "sdk-parity-verified"),
      candidate("candidate-a", "0.1", "on-chain-verified"),
      candidate("candidate-d", "0.4"),
    ]);

    expect(result.candidates.map(({ id }) => id)).toEqual([
      "candidate-a",
      "candidate-b",
      "candidate-c",
    ]);
    expect(result.excluded).toEqual([{ candidateId: "candidate-u", reason: "unverified" }]);
  });

  it("uses candidate id as a stable tie-breaker and respects a one-to-three result limit", () => {
    const input = [candidate("zeta", "0.2"), candidate("beta", "0.2"), candidate("alpha", "0.2")];

    expect(rankSolverCandidates(input, 1).candidates.map(({ id }) => id)).toEqual(["alpha"]);
    expect(rankSolverCandidates(input, 2).candidates.map(({ id }) => id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(rankSolverCandidates(input, 3).candidates.map(({ id }) => id)).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
  });

  it("returns fewer than three when fewer valid candidates are available", () => {
    const result = rankSolverCandidates([candidate("candidate-a", "0.1")]);
    expect(result.candidates.map(({ id }) => id)).toEqual(["candidate-a"]);
  });

  it("rejects duplicate ids, non-finite or negative scores, and invalid limits", () => {
    expect(() =>
      rankSolverCandidates([candidate("duplicate", "0"), candidate("duplicate", "1")]),
    ).toThrow("Duplicate solver candidate id");
    expect(() => rankSolverCandidates([candidate("nan", "NaN")])).toThrow(
      "must have a finite Decimal objective score",
    );
    expect(() => rankSolverCandidates([candidate("negative", "-0.1")])).toThrow(
      "objective score must not be negative",
    );
    expect(() => rankSolverCandidates([], 0)).toThrow(
      "Candidate limit must be an integer from 1 to 3",
    );
  });
});
