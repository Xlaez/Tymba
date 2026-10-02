import type { FeeConfiguration } from "./fees.js";
import {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "./configuration-validation.js";
import type { MarketIntentIssue, NormalizedMarketIntent } from "./market-intent.js";
import { validateMarketIntent } from "./market-intent.js";
import type { MigrationConfiguration } from "./migration.js";
import type { ValidationStatus } from "./status.js";

export type SolverInput = Readonly<{
  marketIntent: unknown;
  feeConfiguration?: unknown;
  migrationConfiguration?: unknown;
}>;

export type NormalizedSolverInput = Readonly<{
  market: NormalizedMarketIntent;
  fees?: FeeConfiguration;
  migrationConfiguration?: MigrationConfiguration;
}>;

export type SolverInputIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type SolverInputValidationResult =
  | Readonly<{
      status: Extract<ValidationStatus, "valid">;
      normalized: NormalizedSolverInput;
    }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly SolverInputIssue[];
    }>;

type UnknownRecord = Record<string, unknown>;
const SOLVER_INPUT_FIELDS = new Set(["marketIntent", "feeConfiguration", "migrationConfiguration"]);

export function normalizeSolverInput(input: unknown): SolverInputValidationResult {
  if (!isRecord(input)) {
    return {
      status: "invalid",
      issues: [{ path: "$", code: "invalid_object", message: "Expected a solver input object" }],
    };
  }

  const issues: SolverInputIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!SOLVER_INPUT_FIELDS.has(key)) {
      issues.push({
        path: `$.${key}`,
        code: "unknown_field",
        message: "Field is not supported in solver input",
      });
    }
  }

  const marketResult = validateMarketIntent(input.marketIntent);
  if (marketResult.status === "invalid") issues.push(...mapMarketIssues(marketResult.issues));

  const feeResult = Object.hasOwn(input, "feeConfiguration")
    ? validateFeeConfiguration(input.feeConfiguration)
    : undefined;
  if (feeResult?.status === "invalid") {
    issues.push(
      ...feeResult.issues.map((issue) => ({
        ...issue,
        path: prefixPath("$.feeConfiguration", issue.path),
      })),
    );
  }

  const migrationResult = Object.hasOwn(input, "migrationConfiguration")
    ? validateMigrationConfiguration(input.migrationConfiguration)
    : undefined;
  if (migrationResult?.status === "invalid") {
    issues.push(
      ...migrationResult.issues.map((issue) => ({
        ...issue,
        path: prefixPath("$.migrationConfiguration", issue.path),
      })),
    );
  }

  if (
    issues.length > 0 ||
    marketResult.status !== "valid" ||
    feeResult?.status === "invalid" ||
    migrationResult?.status === "invalid"
  ) {
    return { status: "invalid", issues };
  }

  return {
    status: "valid",
    normalized: {
      market: marketResult.normalized,
      ...(feeResult?.status === "valid" ? { fees: feeResult.value } : {}),
      ...(migrationResult?.status === "valid"
        ? { migrationConfiguration: migrationResult.value }
        : {}),
    },
  };
}

function mapMarketIssues(issues: readonly MarketIntentIssue[]): readonly SolverInputIssue[] {
  return issues.map((issue) => ({
    path: `$.marketIntent${issue.path.slice(1)}`,
    code: issue.code,
    message: issue.message,
  }));
}

function prefixPath(prefix: string, path: string): string {
  return path === "$" ? prefix : `${prefix}${path.slice(1)}`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
