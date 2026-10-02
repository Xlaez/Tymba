import type { Decimal } from "decimal.js";
import type { CurrencyAmount } from "./currency-amount.js";
import type { DbcCurve } from "./curve.js";
import type { FeeConfiguration } from "./fees.js";
import type { MigrationConfiguration } from "./migration.js";
import type { SolverStatus, VerificationStatus } from "./status.js";

export type { SolverStatus, VerificationStatus } from "./status.js";

export type SolverMetricSet = Readonly<{
  quoteToMigration: CurrencyAmount;
  baseDistributed: CurrencyAmount;
  baseDistributedBps: bigint;
  migrationPrice: Decimal;
  migrationFdv: Decimal;
}>;

export type SolverExplanation = Readonly<{
  code: string;
  message: string;
  segmentIndex?: number;
}>;

export type SolverWarningCode =
  | "constraint_conflict"
  | "target_not_met"
  | "protocol_limit"
  | "unsupported_configuration"
  | "allocation_mapping_unresolved"
  | "verification_pending";

export type SolverWarning = Readonly<{
  code: SolverWarningCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  path?: string;
  candidateId?: string;
  verificationStatus?: VerificationStatus;
}>;

export type SolvedMarketCandidate = Readonly<{
  id: string;
  curve: DbcCurve;
  metrics: SolverMetricSet;
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  objectiveScore: Decimal;
  verificationStatus: VerificationStatus;
  explanations: readonly SolverExplanation[];
}>;

export type SolverResult = Readonly<{
  status: SolverStatus;
  candidates: readonly SolvedMarketCandidate[];
  warnings: readonly SolverWarning[];
}>;
