import { Decimal } from "decimal.js";
import type { AuditFinding } from "./audit.js";
import { MAX_CURVE_U64 } from "./curve.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type { AuditEvidence } from "./audit.js";
import type { AssetAmount } from "./pool-state.js";
import type { SolverObjectiveWeights } from "./solver-objective.js";
import { SOLVER_OBJECTIVE_TERMS } from "./solver-objective.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });
const SUPPORTED_RISK_TERMS = ["earlyPriceImpact", "attackProfitability"] as const;
const BASIS_POINTS = 10_000n;

export type AuditSolverRiskTerm = (typeof SUPPORTED_RISK_TERMS)[number];

export type AuditSolverFindingMapping = Readonly<{
  findingId: string;
  ruleId: string;
  category: AuditFinding["category"];
  metric: AuditFinding["severityMetric"];
  rawMetricValueBps: bigint;
  sourceReference: string;
  severityPolicyId: string;
  severityPolicyVersion: string;
  objectiveTerm: AuditSolverRiskTerm;
  objectiveFormula: string;
  objectiveTargetBps?: bigint;
  objectiveTargetSource?: "original-intent" | "default-zero-minimization";
}>;

export type UnsupportedAuditSolverFinding = Readonly<{
  findingId: string;
  ruleId: string;
  reason: string;
}>;

export type UnsupportedAuditSolverRiskTerm = Readonly<{
  term: AuditSolverRiskTerm;
  reason: string;
}>;

export type AuditSolverObjectiveConversion = Readonly<{
  status: "converted" | "partial" | "unsupported";
  objectiveWeights?: SolverObjectiveWeights;
  appliedRiskWeights: Partial<Pick<SolverObjectiveWeights, AuditSolverRiskTerm>>;
  mappings: readonly AuditSolverFindingMapping[];
  unsupportedFindings: readonly UnsupportedAuditSolverFinding[];
  unsupportedRiskTerms: readonly UnsupportedAuditSolverRiskTerm[];
  requiredEvaluators: readonly ("earlyPriceImpactEvaluator" | "attackExposureEvaluator")[];
}>;

export type ConvertAuditFindingsToSolverObjectiveInput = Readonly<{
  originalWeights: SolverObjectiveWeights;
  findings: readonly AuditFinding[];
  market: NormalizedMarketIntent;
  addedRiskWeights: Partial<Pick<SolverObjectiveWeights, AuditSolverRiskTerm>>;
  earlyPriceImpactProbeQuoteAtomic?: bigint;
}>;

export function convertAuditFindingsToSolverObjective(
  input: ConvertAuditFindingsToSolverObjectiveInput,
): AuditSolverObjectiveConversion {
  validateInput(input);
  const requestedRiskWeights = readRiskWeights(input.addedRiskWeights);
  const requestedRiskWeightTotal = SUPPORTED_RISK_TERMS.reduce(
    (total, term) => total.plus(requestedRiskWeights[term]),
    new ExactDecimal(0),
  );
  if (requestedRiskWeightTotal.gte(1)) {
    throw new RangeError("Added audit-risk weights must sum to less than one");
  }

  const mappings: AuditSolverFindingMapping[] = [];
  const unsupportedFindings: UnsupportedAuditSolverFinding[] = [];
  const seenFindingIds = new Set<string>();
  for (const finding of input.findings) {
    if (seenFindingIds.has(finding.id)) {
      throw new RangeError(`Selected audit finding is duplicated: ${finding.id}`);
    }
    seenFindingIds.add(finding.id);
    const classified = classifyFinding(finding, input);
    if (classified.status === "unsupported") {
      unsupportedFindings.push({
        findingId: finding.id,
        ruleId: finding.ruleId,
        reason: classified.reason,
      });
      continue;
    }
    if (requestedRiskWeights[classified.mapping.objectiveTerm].isZero()) {
      unsupportedFindings.push({
        findingId: finding.id,
        ruleId: finding.ruleId,
        reason: `No positive additional weight was supplied for ${classified.mapping.objectiveTerm}.`,
      });
      continue;
    }
    mappings.push(classified.mapping);
  }

  const mappedTerms = new Set(mappings.map(({ objectiveTerm }) => objectiveTerm));
  const unsupportedRiskTerms = SUPPORTED_RISK_TERMS.flatMap((term) => {
    if (requestedRiskWeights[term].isZero() || mappedTerms.has(term)) return [];
    return [
      {
        term,
        reason: `No compatible selected finding can supply the ${term} measurement.`,
      },
    ];
  });
  if (mappings.length === 0) {
    return {
      status: "unsupported",
      appliedRiskWeights: {},
      mappings,
      unsupportedFindings,
      unsupportedRiskTerms,
      requiredEvaluators: [],
    };
  }

  const appliedRiskWeights: Partial<Pick<SolverObjectiveWeights, AuditSolverRiskTerm>> = {
    ...(mappedTerms.has("earlyPriceImpact")
      ? { earlyPriceImpact: requestedRiskWeights.earlyPriceImpact }
      : {}),
    ...(mappedTerms.has("attackProfitability")
      ? { attackProfitability: requestedRiskWeights.attackProfitability }
      : {}),
  };
  const appliedRiskWeightTotal = SUPPORTED_RISK_TERMS.reduce(
    (total, term) => total.plus(appliedRiskWeights[term]?.toFixed() ?? "0"),
    new ExactDecimal(0),
  );
  const remainingOriginalWeight = new ExactDecimal(1).minus(appliedRiskWeightTotal);
  const originalWeights = readOriginalWeights(input.originalWeights);
  const objectiveWeights = {} as Record<(typeof SOLVER_OBJECTIVE_TERMS)[number], Decimal>;
  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const originalShare = new ExactDecimal(originalWeights[term].toFixed()).mul(
      remainingOriginalWeight,
    );
    const addedRiskShare = appliedRiskWeights[term as AuditSolverRiskTerm];
    objectiveWeights[term] = new ExactDecimal(originalShare.plus(addedRiskShare?.toFixed() ?? "0"));
  }

  const hasUnsupported = unsupportedFindings.length > 0 || unsupportedRiskTerms.length > 0;
  const requiredEvaluators = [
    ...(mappedTerms.has("earlyPriceImpact") ? (["earlyPriceImpactEvaluator"] as const) : []),
    ...(mappedTerms.has("attackProfitability") ? (["attackExposureEvaluator"] as const) : []),
  ];
  return {
    status: hasUnsupported ? "partial" : "converted",
    objectiveWeights,
    appliedRiskWeights,
    mappings,
    unsupportedFindings,
    unsupportedRiskTerms,
    requiredEvaluators,
  };
}

type FindingClassification =
  | Readonly<{ status: "supported"; mapping: AuditSolverFindingMapping }>
  | Readonly<{ status: "unsupported"; reason: string }>;

function classifyFinding(
  finding: AuditFinding,
  input: ConvertAuditFindingsToSolverObjectiveInput,
): FindingClassification {
  if (
    finding.category === "price-stability" &&
    finding.ruleId === "price-stability.early-impact" &&
    finding.severityMetric === "early-price-impact-bps"
  ) {
    if (
      finding.evidence[0]?.source !== "deterministic-simulation" ||
      finding.evidence[0].value.kind !== "basis-points" ||
      finding.evidence[0].value.value !== finding.severityValueBps
    ) {
      return {
        status: "unsupported",
        reason:
          "The selected early-impact finding lacks matching deterministic raw-metric evidence.",
      };
    }
    if (
      typeof input.earlyPriceImpactProbeQuoteAtomic !== "bigint" ||
      input.earlyPriceImpactProbeQuoteAtomic <= 0n ||
      input.earlyPriceImpactProbeQuoteAtomic > MAX_CURVE_U64
    ) {
      return {
        status: "unsupported",
        reason:
          "An explicit positive u64 quote probe is required for a comparable candidate early-impact measurement.",
      };
    }
    const sourceTradeOrdinal = finding.evidence.find(
      ({ metric }) => metric === "maximum-impact source trade ordinal",
    );
    const sourceTradeInput = finding.evidence.find(
      ({ metric }) => metric === "maximum-impact buy trade requested input",
    );
    const sourceTradeQuote = getQuoteAmount(sourceTradeInput);
    if (
      sourceTradeOrdinal?.value.kind !== "count" ||
      sourceTradeOrdinal.value.value !== 0n ||
      sourceTradeInput?.reference !== finding.evidence[0]?.reference ||
      !sourceTradeQuote ||
      sourceTradeQuote.amount.raw !== input.earlyPriceImpactProbeQuoteAtomic
    ) {
      return {
        status: "unsupported",
        reason:
          "The finding must retain a first-trade quote buy whose exact input matches the candidate probe.",
      };
    }
    const intentTargetBps = input.market.maxEarlyPriceImpactBps ?? 0n;
    return {
      status: "supported",
      mapping: {
        ...findingIdentity(finding),
        objectiveTerm: "earlyPriceImpact",
        objectiveFormula: "max(candidate impact bps - numeric objective target bps, 0) / 10000",
        objectiveTargetBps: intentTargetBps,
        objectiveTargetSource:
          input.market.maxEarlyPriceImpactBps === undefined
            ? "default-zero-minimization"
            : "original-intent",
      },
    };
  }

  if (
    finding.category === "sniper-exposure" &&
    finding.ruleId === "sniper-exposure.opening-attacker-profit-p95" &&
    finding.severityMetric === "sniper-return-bps"
  ) {
    const pnlEvidence = finding.evidence.find(
      ({ metric }) => metric === "p95 attacker quote PnL (signed quote amount)",
    );
    const capitalEvidence = finding.evidence.find(
      ({ metric }) => metric === "explicit opening attack capital-at-risk basis (quote amount)",
    );
    const pnl = getQuoteAmount(pnlEvidence);
    const capital = getQuoteAmount(capitalEvidence);
    if (
      !pnl ||
      !capital ||
      capital.amount.raw <= 0n ||
      pnl.amount.decimals !== capital.amount.decimals
    ) {
      return {
        status: "unsupported",
        reason:
          "The selected sniper finding lacks matching quote-PnL and positive quote-capital evidence.",
      };
    }
    const reproducedReturnBps =
      pnl.amount.raw <= 0n ? 0n : (pnl.amount.raw * BASIS_POINTS) / capital.amount.raw;
    if (reproducedReturnBps !== finding.severityValueBps) {
      return {
        status: "unsupported",
        reason:
          "The selected sniper raw metric does not reproduce from its retained PnL and capital evidence.",
      };
    }
    return {
      status: "supported",
      mapping: {
        ...findingIdentity(finding),
        objectiveTerm: "attackProfitability",
        objectiveFormula: "max(candidate attacker quote PnL, 0) / candidate quote capital-at-risk",
      },
    };
  }

  return {
    status: "unsupported",
    reason:
      "No current solver objective term measures this selected audit rule without changing its meaning.",
  };
}

function findingIdentity(finding: AuditFinding) {
  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    category: finding.category,
    metric: finding.severityMetric,
    rawMetricValueBps: finding.severityValueBps,
    sourceReference: finding.evidence[0].reference,
    severityPolicyId: finding.severityPolicyId,
    severityPolicyVersion: finding.severityPolicyVersion,
  };
}

function getQuoteAmount(evidence: AuditEvidence | undefined): AssetAmount<"quote"> | undefined {
  if (!evidence || evidence.value.kind !== "amount") return undefined;
  const value = evidence.value.value;
  if (value.asset !== "quote") return undefined;
  return value as AssetAmount<"quote">;
}

function readOriginalWeights(
  input: SolverObjectiveWeights,
): Record<(typeof SOLVER_OBJECTIVE_TERMS)[number], Decimal> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Original solver objective weights must be an object");
  }
  assertAllowedKeys(input, SOLVER_OBJECTIVE_TERMS, "Original solver objective weights");
  const weights = {} as Record<(typeof SOLVER_OBJECTIVE_TERMS)[number], Decimal>;
  let total = new ExactDecimal(0);
  for (const term of SOLVER_OBJECTIVE_TERMS) {
    const value = input[term];
    if (!Decimal.isDecimal(value) || !value.isFinite() || value.lt(0)) {
      throw new RangeError(`Original ${term} weight must be a finite non-negative Decimal`);
    }
    weights[term] = new ExactDecimal(value.toFixed());
    total = total.plus(weights[term]);
  }
  if (!total.eq(1))
    throw new RangeError("Original solver objective weights must sum exactly to one");
  return weights;
}

function readRiskWeights(
  input: Partial<Pick<SolverObjectiveWeights, AuditSolverRiskTerm>>,
): Record<AuditSolverRiskTerm, Decimal> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Added audit-risk weights must be an object");
  }
  assertAllowedKeys(input, SUPPORTED_RISK_TERMS, "Added audit-risk weights");
  return {
    earlyPriceImpact: readRiskWeight(input.earlyPriceImpact, "earlyPriceImpact"),
    attackProfitability: readRiskWeight(input.attackProfitability, "attackProfitability"),
  };
}

function readRiskWeight(value: Decimal | undefined, term: AuditSolverRiskTerm): Decimal {
  if (value === undefined) return new ExactDecimal(0);
  if (!Decimal.isDecimal(value) || !value.isFinite() || value.lt(0)) {
    throw new RangeError(`Added ${term} risk weight must be a finite non-negative Decimal`);
  }
  return new ExactDecimal(value.toFixed());
}

function validateInput(input: ConvertAuditFindingsToSolverObjectiveInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Audit-to-solver conversion input must be an object");
  }
  if (!Array.isArray(input.findings))
    throw new TypeError("Selected audit findings must be an array");
  if (typeof input.market !== "object" || input.market === null) {
    throw new TypeError("A normalized original market intent is required");
  }
  if (
    input.findings.some(
      (finding) =>
        typeof finding?.id !== "string" ||
        finding.id.trim().length === 0 ||
        typeof finding?.ruleId !== "string" ||
        finding.ruleId.trim().length === 0 ||
        typeof finding?.severityValueBps !== "bigint" ||
        finding.severityValueBps < 0n,
    )
  ) {
    throw new TypeError("Selected audit findings require identity and a non-negative raw metric");
  }
}

function assertAllowedKeys(input: object, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contain unsupported field ${key}`);
  }
}
