import { isDeepStrictEqual } from "node:util";
import type {
  AuditCategoryResult,
  AuditEvidence,
  AuditFinding,
  AuditFindingCategory,
} from "../domain/audit.js";
import {
  type AuditSeverityPolicy,
  DEMO_AUDIT_SEVERITY_POLICY,
  validateAuditSeverityPolicy,
} from "../domain/audit-policy.js";
import { analyzeConcentration } from "../domain/concentration-audit.js";
import { currencyAmount, formatCurrencyAmount } from "../domain/currency-amount.js";
import { analyzeEarlyAdvantage } from "../domain/early-advantage-audit.js";
import { analyzeExitLiquiditySensitivity } from "../domain/exit-liquidity-audit.js";
import { analyzeFeeShock } from "../domain/fee-shock-audit.js";
import { analyzeMigrationFragility } from "../domain/migration-fragility-audit.js";
import { analyzePostMigrationLiquidity } from "../domain/post-migration-liquidity-audit.js";
import { analyzePriceStability } from "../domain/price-stability-audit.js";
import type { DeterministicSimulationResult } from "../domain/simulation.js";
import { executeBuy } from "../domain/simulator.js";
import { analyzeSniperExposure } from "../domain/sniper-exposure-audit.js";
import { analyzeSurplusBehavior } from "../domain/surplus-behavior-audit.js";
import { jsonSnapshot, parseWebAttack, presentAttack, runWebAttack } from "./attack.js";
import { prepareWebCandidate } from "./candidate.js";
import type { WebAuditFinding, WebAuditResponse } from "./contracts.js";
import { isRecord } from "./review.js";
import { simulateWebDocument } from "./simulate.js";

export function prepareWebAudit(input: unknown) {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (key) => !["compileRequest", "candidateId", "trades", "attacks", "policy"].includes(key),
    ) ||
    !Array.isArray(input.attacks) ||
    input.attacks.length > 5
  )
    throw new TypeError(
      "Audit requires compileRequest, candidateId, up to five explicit attack requests, optional trades, and policy.",
    );
  const prepared = prepareWebCandidate(input.compileRequest, input.candidateId);
  const requests = input.attacks.map(parseWebAttack);
  if (new Set(requests.map((request) => request.scenario)).size !== requests.length)
    throw new RangeError("Retain at most one run per attack scenario.");
  for (const request of requests)
    if (
      request.candidateId !== prepared.candidate.id ||
      !isDeepStrictEqual(request.compileRequest, input.compileRequest)
    )
      throw new RangeError("All audit evidence must use this exact candidate and compile request.");
  const policy = parseWebPolicy(input.policy);
  const attacks = requests.map(runWebAttack);
  const deterministicRuns: DeterministicSimulationResult[] = [prepared.candidate.simulation];
  let script: DeterministicSimulationResult | undefined;
  if (input.trades !== undefined) {
    const result = simulateWebDocument(
      {
        compileRequest: input.compileRequest,
        candidateId: prepared.candidate.id,
        trades: input.trades,
      },
      (run) => {
        script = run;
      },
    );
    if (result.status === "failed" || !script)
      throw new RangeError(
        result.status === "failed"
          ? result.issues.map((issue) => issue.message).join("; ")
          : "No script evidence available.",
      );
    deterministicRuns.push(script);
  }
  const openingSniperRuns = attacks.flatMap((document, index) => {
    const result = document.result;
    const request = requests[index];
    if (
      !result ||
      result.status === "failed" ||
      result.scenario !== "opening-sniper" ||
      !request ||
      !isRecord(request.configuration) ||
      !isRecord(request.configuration.attacker)
    )
      return [];
    return [
      {
        result,
        capitalAtRiskQuote: {
          asset: "quote" as const,
          amount: currencyAmount(
            BigInt(request.configuration.attacker.initialQuoteBalanceAtomic as string),
            prepared.market.quoteDecimals,
          ),
        },
      },
    ];
  });
  const whaleEntryRuns = attacks.flatMap(({ result }) =>
    result && result.status !== "failed" && result.scenario === "whale-entry" ? [result] : [],
  );
  const pumpAndDumpRuns = attacks.flatMap(({ result }) =>
    result && result.status !== "failed" && result.scenario === "pump-and-dump" ? [result] : [],
  );
  const sellCascadeRuns = attacks.flatMap(({ result }) =>
    result && result.status !== "failed" && result.scenario === "sell-cascade" ? [result] : [],
  );
  const feeRuns = attacks.flatMap(({ result }, index) => {
    if (!result || result.status === "failed" || result.scenario !== "fee-schedule-timing")
      return [];
    const request = requests[index];
    const state = prepared.candidate.simulation.initialState;
    return [
      {
        result,
        initialState: request?.warmupQuoteAtomic
          ? executeBuy(BigInt(request.warmupQuoteAtomic), state)
          : state,
      },
    ];
  });
  const common = {
    auditId: `web-audit-${prepared.candidate.id}`,
    candidateId: prepared.candidate.id,
    policy,
  };
  const categories: AuditCategoryResult<AuditFindingCategory>[] = [
    analyzePriceStability({ ...common, deterministicRuns }),
    analyzeConcentration({ ...common, whaleEntryRuns }),
    analyzeEarlyAdvantage({ ...common, stochasticRuns: [] }),
    analyzeSniperExposure({ ...common, openingSniperRuns }),
    analyzeExitLiquiditySensitivity({
      ...common,
      openingSniperRuns: openingSniperRuns.map((run) => run.result),
      pumpAndDumpRuns,
      sellCascadeRuns,
    }),
    analyzeMigrationFragility({ ...common, stressPairs: [] }),
    analyzeFeeShock({ ...common, runs: feeRuns }),
    analyzeSurplusBehavior({ ...common, deterministicRuns }),
    analyzePostMigrationLiquidity({ ...common, deterministicRuns }),
  ];
  return {
    ...prepared,
    requests,
    attacks,
    categories,
    policy,
    script,
    findings: categories.flatMap((category) => category.findings),
  };
}

export function parseWebPolicy(input: unknown): AuditSeverityPolicy {
  if (input === undefined) return DEMO_AUDIT_SEVERITY_POLICY;
  if (
    !isRecord(input) ||
    !isRecord(input.thresholds) ||
    Object.keys(input).some(
      (key) => !["id", "version", "classification", "label", "thresholds"].includes(key),
    )
  )
    throw new TypeError(
      "Severity policy must contain its identity, classification, label, and complete thresholds.",
    );
  const thresholds = Object.fromEntries(
    Object.entries(input.thresholds).map(([metric, value]) => {
      if (
        !isRecord(value) ||
        Object.keys(value).some(
          (key) => !["moderateAtOrAboveBps", "highAtOrAboveBps"].includes(key),
        )
      )
        throw new TypeError("Invalid policy threshold fields.");
      return [
        metric,
        Object.fromEntries(
          Object.entries(value).map(([key, raw]) => {
            if (typeof raw !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(raw))
              throw new TypeError(
                "Policy thresholds must be non-negative integer strings in basis points.",
              );
            return [key, BigInt(raw)];
          }),
        ),
      ];
    }),
  );
  const policy = { ...input, thresholds } as AuditSeverityPolicy;
  validateAuditSeverityPolicy(policy);
  if (
    policy.id === DEMO_AUDIT_SEVERITY_POLICY.id &&
    policy.version === DEMO_AUDIT_SEVERITY_POLICY.version &&
    !isDeepStrictEqual(policy, DEMO_AUDIT_SEVERITY_POLICY)
  )
    throw new RangeError(
      "Change the policy version when editing demo-v1 so its results stay reproducible.",
    );
  return policy;
}

const missingReasons: Partial<Record<AuditFindingCategory, string>> = {
  concentration: "No completed whale-entry or tracked-holder stochastic evidence.",
  "early-advantage":
    "No standalone stochastic buyer-cohort run has been supplied to this web audit.",
  "sniper-exposure": "No completed opening-sniper iterations and explicit capital basis.",
  "exit-liquidity-sensitivity": "No completed exit-attack iterations.",
  "migration-fragility": "No paired same-seed late-stage capital-stress runs.",
  "fee-shock": "No completed scheduled-fee timing sweep.",
  "post-migration-liquidity":
    "No measured post-migration LP-liquidity allocation; curve completion is not DAMM settlement.",
};

export function auditWebDocument(input: unknown): WebAuditResponse {
  try {
    const result = prepareWebAudit(input);
    return {
      status: result.categories.some((category) => category.status !== "completed")
        ? "partial"
        : "completed",
      candidateId: result.candidate.id,
      policy: jsonSnapshot(result.policy),
      categories: result.categories.map((category) => ({
        category: category.category,
        status: category.status,
        ...(category.status === "unavailable"
          ? {
              reason:
                missingReasons[category.category] ??
                "No eligible source evidence for this category.",
            }
          : {}),
        findings: category.findings.map(presentFinding),
      })),
      snapshot: jsonSnapshot({
        schemaVersion: 1,
        evidenceClassification: "modeled",
        verificationStatus: "unverified",
        request: input,
        categories: result.categories,
        deterministicRuns: [result.candidate.simulation, ...(result.script ? [result.script] : [])],
        attacks: result.attacks.map(presentAttack),
      }),
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Audit failed; no findings available.",
    };
  }
}

function presentFinding(finding: AuditFinding): WebAuditFinding {
  return {
    id: finding.id,
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    metric: finding.severityMetric,
    rawValueBps: finding.severityValueBps.toString(),
    thresholds: `${finding.severityThresholds.moderateAtOrAboveBps} / ${finding.severityThresholds.highAtOrAboveBps} bps`,
    policyVersion: `${finding.severityPolicyId}/${finding.severityPolicyVersion}`,
    summary: finding.summary,
    evidence: finding.evidence.map(presentEvidence),
    remediations: finding.suggestedRemediations,
  };
}

function presentEvidence(evidence: AuditEvidence): string {
  const value = evidence.value;
  const text =
    value.kind === "amount"
      ? `${formatCurrencyAmount(value.value.amount)} ${value.value.asset} (${value.value.amount.raw} atomic; ${value.value.amount.decimals} decimals)`
      : `${value.value.toString()} ${value.kind}`;
  return `${evidence.metric}: ${text} · ${evidence.source} · ${evidence.reference}`;
}
