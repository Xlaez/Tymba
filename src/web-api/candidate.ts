import { Decimal } from "decimal.js";
import { compileDocument } from "../cli/compile.js";
import { convertConfigBigintStrings } from "../cli/validate.js";
import type {
  InverseCurveSolverOptions,
  InverseCurveSolverResult,
} from "../domain/inverse-curve-solver.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import { validateSolverSimulationConfiguration } from "../domain/solver-deterministic-verification.js";
import { SOLVER_OBJECTIVE_TERMS, type SolverObjectiveWeights } from "../domain/solver-objective.js";
import { isRecord } from "./review.js";

export function prepareWebCandidate(input: unknown, candidateId: unknown) {
  if (!isRecord(input) || typeof candidateId !== "string")
    throw new TypeError("Select a compiled draft.");
  const retained: { result?: InverseCurveSolverResult } = {};
  const report = compileDocument(input, (result) => {
    retained.result = result;
  });
  if (!report.draftCandidates.some((candidate) => candidate.id === candidateId))
    throw new RangeError(
      report.draftCandidates.length
        ? "Unknown candidate for this exact request."
        : report.failure.message,
    );
  const market = validateMarketIntent(input.marketIntent);
  const simulation = validateSolverSimulationConfiguration(
    convertConfigBigintStrings(input.simulation, "$.simulation"),
  );
  if (
    market.status !== "valid" ||
    simulation.status !== "valid" ||
    !isRecord(input.objectiveWeights)
  )
    throw new RangeError("Invalid candidate configuration.");
  const weights = input.objectiveWeights;
  const options: InverseCurveSolverOptions = {
    objectiveWeights: Object.fromEntries(
      SOLVER_OBJECTIVE_TERMS.map((term) => [term, new Decimal(weights[term] as string)]),
    ) as SolverObjectiveWeights,
    simulation: simulation.value,
    ...(input.earlyPriceImpactProbeQuoteAtomic === undefined
      ? {}
      : {
          earlyPriceImpactProbeQuoteAtomic: BigInt(
            input.earlyPriceImpactProbeQuoteAtomic as string,
          ),
        }),
  };
  const candidate = retained.result?.candidates.find((candidate) => candidate.id === candidateId);
  if (!candidate) throw new RangeError("Candidate replay failed.");
  return { market: market.normalized, options, candidate };
}
