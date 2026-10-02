import { Decimal } from "decimal.js";
import type { ConfigurationValidationIssue } from "../domain/configuration-validation.js";
import {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "../domain/configuration-validation.js";
import type {
  MarketIntent,
  MarketIntentIssue,
  NormalizedMarketIntent,
} from "../domain/market-intent.js";
import { validateMarketIntent } from "../domain/market-intent.js";

const CONFIG_BIGINT_FIELDS = new Set([
  "feeBps",
  "startingFeeBps",
  "endingFeeBps",
  "periodCount",
  "periodFrequency",
  "binStepBps",
  "filterPeriodSeconds",
  "decayPeriodSeconds",
  "reductionFactorBps",
  "maxVolatilityAccumulator",
  "variableFeeControl",
  "creatorTradingFeeShareBps",
  "creatorFeeShareBps",
  "creatorLockedBps",
  "partnerLockedBps",
  "unlockedBps",
  "permanentlyLockedBps",
  "vestingBps",
  "lockDurationSeconds",
  "compoundingFeeBps",
]);

export type CliValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type CliConfigurationStatus = "not-provided" | "valid" | "invalid";

export type MarketIntentSummary = Readonly<{
  market: string;
  totalBase: string;
  startPrice: string;
  startFdv: string;
  migrationPrice: string;
  migrationFdv: string;
  quoteToMigration?: string;
  baseDistributionPct?: string;
  maxSegments: number;
}>;

export type CliValidationReport = Readonly<{
  status: "valid" | "invalid";
  intentStatus: "valid" | "invalid";
  configurations: Readonly<{
    fees: CliConfigurationStatus;
    migration: CliConfigurationStatus;
  }>;
  summary?: MarketIntentSummary;
  issues: readonly CliValidationIssue[];
}>;

export function validateDocuments(
  intentInput: unknown,
  feesInput?: unknown,
  migrationInput?: unknown,
): CliValidationReport {
  const intentResult = validateMarketIntent(intentInput);
  const feeResult = validateOptionalConfiguration(feesInput, "fees");
  const migrationResult = validateOptionalConfiguration(migrationInput, "migration");
  const issues: CliValidationIssue[] = [
    ...(intentResult.status === "invalid" ? mapIntentIssues(intentResult.issues) : []),
    ...feeResult.issues,
    ...migrationResult.issues,
  ];
  const isValid =
    intentResult.status === "valid" &&
    feeResult.status !== "invalid" &&
    migrationResult.status !== "invalid";

  return {
    status: isValid ? "valid" : "invalid",
    intentStatus: intentResult.status,
    configurations: { fees: feeResult.status, migration: migrationResult.status },
    ...(intentResult.status === "valid"
      ? { summary: summarizeIntent(intentResult.intent, intentResult.normalized) }
      : {}),
    issues,
  };
}

export function formatValidationReport(report: CliValidationReport): string {
  const lines = [`Validation: ${report.status.toUpperCase()}`];
  if (report.summary) {
    const summary = report.summary;
    const [baseSymbol = "", quoteSymbol = ""] = summary.market.split("/");
    lines.push(
      `Market: ${summary.market}`,
      `Total base supply: ${summary.totalBase} ${baseSymbol}`,
      `Starting price: ${summary.startPrice} ${quoteSymbol} per ${baseSymbol}`,
      `Starting fully diluted value: ${summary.startFdv} ${quoteSymbol}`,
      `Graduation price: ${summary.migrationPrice} ${quoteSymbol} per ${baseSymbol}`,
      `Graduation fully diluted value: ${summary.migrationFdv} ${quoteSymbol}`,
      `Capital target before graduation: ${summary.quoteToMigration ?? "not specified"} ${quoteSymbol}`,
      `Supply distribution target: ${summary.baseDistributionPct === undefined ? "not specified" : `${summary.baseDistributionPct}%`}`,
      `Maximum curve segments: ${summary.maxSegments}`,
    );
  }
  lines.push(
    `Fees configuration: ${report.configurations.fees}`,
    `Migration configuration: ${report.configurations.migration}`,
  );
  if (report.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of report.issues)
      lines.push(`- ${issue.path} [${issue.code}]: ${issue.message}`);
  }
  return lines.join("\n");
}

function validateOptionalConfiguration(
  input: unknown,
  kind: "fees" | "migration",
): Readonly<{ status: CliConfigurationStatus; issues: readonly CliValidationIssue[] }> {
  if (input === undefined) return { status: "not-provided", issues: [] };

  let normalized: unknown;
  try {
    normalized = convertConfigBigintStrings(input, `$.${kind}`);
  } catch (error) {
    return {
      status: "invalid",
      issues: [
        {
          path: error instanceof ConfigIntegerError ? error.path : `$.${kind}`,
          code: "invalid_integer_string",
          message:
            error instanceof Error
              ? error.message
              : "Configuration integer fields must be decimal strings",
        },
      ],
    };
  }

  const result =
    kind === "fees"
      ? validateFeeConfiguration(normalized)
      : validateMigrationConfiguration(normalized);
  return result.status === "valid"
    ? { status: "valid", issues: [] }
    : { status: "invalid", issues: mapConfigurationIssues(kind, result.issues) };
}

function convertConfigBigintStrings(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((element, index) => convertConfigBigintStrings(element, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const entryPath = `${path}.${key}`;
      if (CONFIG_BIGINT_FIELDS.has(key)) {
        if (typeof entry !== "string" || !/^-?\d+$/.test(entry)) {
          throw new ConfigIntegerError(entryPath);
        }
        return [key, BigInt(entry)];
      }
      return [key, convertConfigBigintStrings(entry, entryPath)];
    }),
  );
}

function summarizeIntent(
  intent: MarketIntent,
  normalized: NormalizedMarketIntent,
): MarketIntentSummary {
  const summary: MarketIntentSummary = {
    market: `${intent.assets.base.symbol}/${intent.assets.quote.symbol}`,
    totalBase: intent.supply.totalBase,
    startPrice: normalized.startPrice.toFixed(),
    startFdv: normalized.startFdv.toFixed(),
    migrationPrice: normalized.migrationPrice.toFixed(),
    migrationFdv: normalized.migrationFdv.toFixed(),
    maxSegments: normalized.maxSegments,
    ...(intent.targets.quoteToMigration === undefined
      ? {}
      : { quoteToMigration: intent.targets.quoteToMigration }),
    ...(normalized.targetBaseDistributionBps === undefined
      ? {}
      : {
          baseDistributionPct: new Decimal(normalized.targetBaseDistributionBps.toString())
            .div(100)
            .toFixed(),
        }),
  };
  return summary;
}

function mapIntentIssues(issues: readonly MarketIntentIssue[]): readonly CliValidationIssue[] {
  return issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message }));
}

function mapConfigurationIssues(
  kind: "fees" | "migration",
  issues: readonly ConfigurationValidationIssue[],
): readonly CliValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path === "$" ? `$.${kind}` : `$.${kind}${issue.path.slice(1)}`,
    code: issue.code,
    message: issue.message,
  }));
}

class ConfigIntegerError extends TypeError {
  readonly path: string;

  constructor(path: string) {
    super("Configuration integer fields must be decimal strings");
    this.path = path;
  }
}
