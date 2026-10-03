import type { CliAttackScenario } from "../cli/attack.js";
import type { AuditFindingCategory, AuditSeverity } from "../domain/audit.js";

export type WebHardeningResponse = Readonly<{
  status: "completed" | "partial" | "failed" | "unsatisfied";
  message: string;
  notices: readonly string[];
  originalCandidateId?: string;
  hardenedCandidateId?: string;
  metrics: readonly Readonly<{
    id: string;
    label: string;
    unit: string;
    direction: string;
    status: string;
    baseline: string | null;
    hardened: string | null;
    delta: string | null;
    improved: boolean | null;
    references: readonly string[];
    reason: string;
  }>[];
  snapshot?: JsonValue;
  advanced?: WebAdvancedParameters;
}>;

export type WebAdvancedParameters = Readonly<{
  candidateId: string;
  baseDecimals: number;
  quoteDecimals: number;
  totalBaseAtomic: string;
  startSqrtPriceQ64x64: string;
  migrationQuoteThresholdAtomic: string;
  segments: readonly Readonly<{
    lowerSqrtPriceQ64x64: string;
    upperSqrtPriceQ64x64: string;
    liquidity: string;
  }>[];
  settings: JsonValue;
  sdkVersion: string;
}>;

export type WebAuditFinding = Readonly<{
  id: string;
  title: string;
  category: AuditFindingCategory;
  severity: AuditSeverity;
  metric: string;
  rawValueBps: string;
  thresholds: string;
  policyVersion: string;
  summary: string;
  evidence: readonly string[];
  remediations: readonly string[];
}>;
export type WebAuditRequest = Readonly<{
  compileRequest: unknown;
  candidateId: string;
  attacks: readonly WebAttackRequest[];
  trades?: readonly WebTradeInput[];
  policy?: unknown;
}>;
export type WebAuditResponse =
  | Readonly<{ status: "failed"; message: string }>
  | Readonly<{
      status: "completed" | "partial";
      candidateId: string;
      policy: JsonValue;
      categories: readonly Readonly<{
        category: AuditFindingCategory;
        status: "completed" | "partial" | "unavailable";
        reason?: string;
        findings: readonly WebAuditFinding[];
      }>[];
      snapshot: JsonValue;
    }>;

import type { MarketIntentSummary } from "../cli/validate.js";
import type { MarketIntent } from "../domain/market-intent.js";
import type { SolverAlternative } from "../domain/solver-result.js";
import type { SolverStatus } from "../domain/status.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type WebAttackRequest = Readonly<{
  compileRequest: unknown;
  candidateId: string;
  scenario: CliAttackScenario;
  configuration: unknown;
  warmupQuoteAtomic?: string;
}>;
export type WebAttackResponse = Readonly<{
  status: "blocked" | "completed" | "partial" | "failed" | "unsupported";
  candidateId?: string;
  scenario?: CliAttackScenario;
  message: string;
  metrics?: JsonValue;
  snapshot?: JsonValue;
  summary?: Readonly<{
    seed: string | null;
    requested: string;
    completed: string;
    partial: string;
    failed: string;
    countUnit: "iterations" | "clock candidates";
    engineVersion: string;
    sdkVersion: string;
  }>;
  measurements?: readonly Readonly<{ label: string; value: string; unit: string }>[];
}>;

export type WebIssue = Readonly<{ path: string; code: string; message: string }>;

export type ReviewResponse =
  | Readonly<{
      status: "valid";
      intent: MarketIntent;
      summary: MarketIntentSummary;
      designNote: string;
    }>
  | Readonly<{ status: "invalid"; issues: readonly WebIssue[] }>;

export type WebConflict = Readonly<{
  message: string;
  alternatives?: readonly SolverAlternative[];
}>;

export type WebDraftCandidate = {
  id: string;
  rank: number;
  segmentCount: number;
  objectiveScore: string;
  quoteToMigration: string;
  baseDistributed: string;
  baseDistributionPct: string;
  migrationPrice: string;
  migrationFdv: string;
  verificationStatus: "unverified";
  sdkCurveValidated: true;
  simulationId: string;
  conflicts: WebConflict[];
  segments: readonly WebCurveSegment[];
  advanced?: WebAdvancedParameters;
};

export type WebCurveSegment = Readonly<{
  index: number;
  lowerPrice: string;
  upperPrice: string;
  quoteAbsorbed: string;
  baseDistributed: string;
  quoteContributionPct: string;
  distributionContributionPct: string;
  explanation: string;
  points: readonly Readonly<{ quote: string; price: string }>[];
}>;

export type WebCompileResponse = Readonly<{
  status: "blocked" | "failed";
  solverStatus?: SolverStatus;
  candidates: readonly WebDraftCandidate[];
  candidateCount: number;
  deployableCandidateCount: 0;
  failure: Readonly<{ code: string; message: string }>;
  issues: readonly WebIssue[];
  warnings: readonly string[];
  engineVersion: string;
  sdkVersion: string;
  algorithmVersion: string;
}>;

export type WebTradeInput = Readonly<{
  direction: "buy" | "sell";
  amount: string;
  slot: string;
  timestampSeconds: string;
}>;

export type WebTradeOutput = Readonly<{
  direction: "buy" | "sell";
  status: "filled" | "partial";
  requestedInput: string;
  consumedInput: string;
  unfilledInput: string;
  output: string;
  spotPriceAfter: string;
  priceImpactPct: string;
  fee: string;
  feeAsset: "base" | "quote";
}>;

export type WebSimulationResponse =
  | Readonly<{ status: "failed"; issues: readonly WebIssue[] }>
  | Readonly<{
      status: "completed" | "partial";
      id: string;
      candidateId: string;
      engineVersion: string;
      sdkVersion: string;
      verificationStatus: "unverified";
      lifecycle: string;
      randomSeed: null;
      inputTrades: readonly WebTradeInput[];
      trades: readonly WebTradeOutput[];
      metrics: Readonly<{
        finalSpotPrice: string;
        quoteAccumulated: string;
        baseDistributed: string;
        baseDistributionPct: string;
        migrationProgressPct: string;
        maximumPriceImpactPct: string;
        maximumDrawdownPct: string;
        baseFees: string;
        quoteFees: string;
      }>;
    }>;
