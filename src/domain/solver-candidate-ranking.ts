import { Decimal } from "decimal.js";
import type { VerificationStatus } from "./status.js";

export type RankableSolverCandidate = Readonly<{
  id: string;
  objectiveScore: Decimal;
  verificationStatus: VerificationStatus;
}>;

export type SolverCandidateRankingResult<Candidate> = Readonly<{
  candidates: readonly Candidate[];
  excluded: readonly Readonly<{
    candidateId: string;
    reason: "unverified";
  }>[];
}>;

export function rankSolverCandidates<Candidate extends RankableSolverCandidate>(
  candidates: readonly Candidate[],
  limit = 3,
): SolverCandidateRankingResult<Candidate> {
  if (!Array.isArray(candidates)) throw new TypeError("Solver candidates must be an array");
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) {
    throw new RangeError("Candidate limit must be an integer from 1 to 3");
  }

  const ids = new Set<string>();
  const eligible: Candidate[] = [];
  const excluded: { candidateId: string; reason: "unverified" }[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new TypeError(`Solver candidate ${index} must be an object`);
    }
    validateCandidate(candidate, index);
    if (ids.has(candidate.id))
      throw new TypeError(`Duplicate solver candidate id: ${candidate.id}`);
    ids.add(candidate.id);

    if (candidate.verificationStatus === "unverified") {
      excluded.push({ candidateId: candidate.id, reason: "unverified" });
    } else {
      eligible.push(candidate);
    }
  }

  eligible.sort(compareCandidates);
  return {
    candidates: eligible.slice(0, limit),
    excluded,
  };
}

function validateCandidate(candidate: RankableSolverCandidate, index: number): void {
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > 128 ||
    Array.from(candidate.id).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new TypeError(`Solver candidate ${index} must have a non-empty safe id`);
  }
  if (!Decimal.isDecimal(candidate.objectiveScore) || !candidate.objectiveScore.isFinite()) {
    throw new TypeError(
      `Solver candidate ${candidate.id} must have a finite Decimal objective score`,
    );
  }
  if (candidate.objectiveScore.lt(0)) {
    throw new RangeError(`Solver candidate ${candidate.id} objective score must not be negative`);
  }
  if (
    candidate.verificationStatus !== "unverified" &&
    candidate.verificationStatus !== "sdk-validated" &&
    candidate.verificationStatus !== "sdk-parity-verified" &&
    candidate.verificationStatus !== "on-chain-verified"
  ) {
    throw new TypeError(`Solver candidate ${candidate.id} has an unsupported verification status`);
  }
}

function compareCandidates(left: RankableSolverCandidate, right: RankableSolverCandidate): number {
  const scoreOrder = left.objectiveScore.comparedTo(right.objectiveScore);
  if (scoreOrder !== 0) return scoreOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}
