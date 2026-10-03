import { DEMO_AUDIT_SEVERITY_POLICY, validateAuditSeverityPolicy } from "./audit-policy.js";
import type { AuditSeverityPolicy } from "./audit-policy.js";
import type { AuditCategoryResult, AuditEvidence, AuditMetricObservation } from "./audit.js";
import { createAuditFinding } from "./audit-finding.js";
import type { DeterministicSimulationResult } from "./simulation.js";

const BASIS_POINTS = 10_000n;

export type PostMigrationLiquidityAuditInput = Readonly<{
  auditId: string;
  candidateId: string;
  deterministicRuns: readonly DeterministicSimulationResult[];
  policy?: AuditSeverityPolicy;
}>;

export type PostMigrationLiquidityAuditResult = AuditCategoryResult<"post-migration-liquidity">;

export function analyzePostMigrationLiquidity(
  input: PostMigrationLiquidityAuditInput,
): PostMigrationLiquidityAuditResult {
  validateInput(input);
  const policy = input.policy ?? DEMO_AUDIT_SEVERITY_POLICY;
  validateAuditSeverityPolicy(policy);
  const observations: AuditMetricObservation[] = [];

  for (const run of input.deterministicRuns) {
    const allocation = run.metrics.liquidityAllocation;
    if (!allocation) continue;
    validateAllocation(run.id, allocation);
    const denominator = allocation.distributableLiquidity;
    const unlocked = allocation.creator.unlocked + allocation.partner.unlocked;
    const vesting = allocation.creator.vesting + allocation.partner.vesting;
    const permanentlyLocked =
      allocation.creator.permanentlyLocked + allocation.partner.permanentlyLocked;
    const shareBps = (value: bigint) => (value * BASIS_POINTS) / denominator;
    const evidence: AuditEvidence[] = [
      countEvidence(run.id, "distributable post-migration liquidity units", denominator),
      countEvidence(run.id, "creator unlocked liquidity units", allocation.creator.unlocked),
      countEvidence(run.id, "creator vesting liquidity units", allocation.creator.vesting),
      countEvidence(
        run.id,
        "creator permanently locked liquidity units",
        allocation.creator.permanentlyLocked,
      ),
      countEvidence(run.id, "partner unlocked liquidity units", allocation.partner.unlocked),
      countEvidence(run.id, "partner vesting liquidity units", allocation.partner.vesting),
      countEvidence(
        run.id,
        "partner permanently locked liquidity units",
        allocation.partner.permanentlyLocked,
      ),
      bpsEvidence(run.id, "aggregate unlocked share (floor basis points)", shareBps(unlocked)),
      bpsEvidence(run.id, "aggregate vesting share (floor basis points)", shareBps(vesting)),
      bpsEvidence(
        run.id,
        "aggregate permanently locked share (floor basis points)",
        shareBps(permanentlyLocked),
      ),
    ];
    observations.push({
      category: "post-migration-liquidity",
      ruleId: "post-migration-liquidity.unlocked-share",
      source: "deterministic-simulation",
      reference: run.id,
      metric: "unlocked-post-migration-liquidity-bps",
      valueBps: shareBps(unlocked),
      metricDescription:
        "aggregate creator and partner post-migration unlocked-liquidity share, floored to basis points",
      supportingEvidence: evidence,
    });
  }

  const findings = observations.map((observation) =>
    createAuditFinding({
      auditId: input.auditId,
      policy,
      observation,
      title: "Unlocked post-migration liquidity exposure",
      explanation: `The raw unlocked share is reported alongside exact creator/partner bucket units and the separate vesting and permanently locked shares from deterministic run ${observation.reference}. Severity is the selected illustrative policy's assessment of unlocked exposure, not a claim that more locked liquidity is always preferable. Allocation and lock execution remain modeled unless verified against the destination protocol.`,
      remediation:
        "If immediate withdrawal exposure is outside the intended profile, move a portion of unlocked LP allocation into vesting or permanent lock; trade-off: less immediately available liquidity can reduce flexibility, market depth, or price discovery, while longer locks constrain recipients.",
    }),
  );

  return {
    auditId: input.auditId,
    candidateId: input.candidateId,
    category: "post-migration-liquidity",
    status:
      findings.length === 0
        ? "unavailable"
        : input.deterministicRuns.some((run) => run.status === "partial")
          ? "partial"
          : "completed",
    evidenceClassification: "modeled",
    severityPolicy: policy,
    observations,
    findings,
  };
}

function countEvidence(reference: string, metric: string, value: bigint): AuditEvidence {
  return {
    source: "deterministic-simulation",
    reference,
    metric,
    value: { kind: "count", value },
  };
}

function bpsEvidence(reference: string, metric: string, value: bigint): AuditEvidence {
  return {
    source: "deterministic-simulation",
    reference,
    metric,
    value: { kind: "basis-points", value },
  };
}

function validateAllocation(
  reference: string,
  allocation: NonNullable<DeterministicSimulationResult["metrics"]["liquidityAllocation"]>,
): void {
  const buckets = [
    allocation.creator.unlocked,
    allocation.creator.vesting,
    allocation.creator.permanentlyLocked,
    allocation.partner.unlocked,
    allocation.partner.vesting,
    allocation.partner.permanentlyLocked,
  ];
  if (
    typeof allocation.distributableLiquidity !== "bigint" ||
    allocation.distributableLiquidity <= 0n ||
    buckets.some((value) => typeof value !== "bigint" || value < 0n)
  ) {
    throw new RangeError(`Post-migration liquidity allocation is invalid for run ${reference}`);
  }
  if (buckets.reduce((sum, value) => sum + value, 0n) !== allocation.distributableLiquidity) {
    throw new RangeError(
      `Post-migration liquidity buckets do not conserve units for run ${reference}`,
    );
  }
}

function validateInput(input: PostMigrationLiquidityAuditInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Post-migration-liquidity audit input must be an object");
  }
  for (const [name, value] of [
    ["audit id", input.auditId],
    ["candidate id", input.candidateId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Post-migration-liquidity ${name} must be non-empty`);
    }
  }
  if (!Array.isArray(input.deterministicRuns)) {
    throw new TypeError("Post-migration-liquidity deterministic runs must be an array");
  }
  if (
    input.deterministicRuns.some((run) => typeof run.id !== "string" || run.id.trim().length === 0)
  ) {
    throw new TypeError("Post-migration-liquidity simulation references must be non-empty");
  }
}
