import type { FeeClock, FeeConfiguration } from "./fees.js";
import {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "./configuration-validation.js";
import type { MigrationConfiguration } from "./migration.js";
import { MAX_CURVE_U64 } from "./curve.js";
import type { NormalizedMarketIntent } from "./market-intent.js";
import type { DeterministicSimulationResult } from "./simulation.js";
import type { DynamicFeeState, PoolState, SimulationClock } from "./pool-state.js";
import { currencyAmount } from "./currency-amount.js";
import { quoteBuy, runDeterministicSimulation } from "./simulator.js";
import { baseDistributedForSegments, quoteRequiredForSegments } from "./segment-math.js";
import type { DbcCurve } from "./curve.js";
import { validatePoolState } from "./pool-state-validation.js";
import type { ValidationStatus } from "./status.js";

export type SolverSimulationConfiguration = Readonly<{
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  supplyMode: "fixed" | "dynamic";
  clock: SimulationClock;
  activationPoint: bigint;
  activationType: FeeClock;
  dynamicFeeState?: DynamicFeeState;
}>;

export type SolverSimulationConfigurationIssue = Readonly<{
  code: string;
  message: string;
}>;

export type SolverSimulationConfigurationValidationResult =
  | Readonly<{
      status: Extract<ValidationStatus, "valid">;
      value: SolverSimulationConfiguration;
    }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly SolverSimulationConfigurationIssue[];
    }>;

export type SolverSimulationVerificationResult =
  | Readonly<{
      status: "verified";
      simulation: DeterministicSimulationResult;
    }>
  | Readonly<{
      status: "invalid";
      issues: readonly SolverSimulationConfigurationIssue[];
    }>;

export function validateSolverSimulationConfiguration(
  input: unknown,
): SolverSimulationConfigurationValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalidConfiguration(
      "missing_simulation_configuration",
      "Explicit simulator configuration is required",
    );
  }

  const record = input as Record<string, unknown>;
  const issues: SolverSimulationConfigurationIssue[] = [];
  const allowedKeys = new Set([
    "fees",
    "migration",
    "supplyMode",
    "clock",
    "activationPoint",
    "activationType",
    "dynamicFeeState",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        code: "unknown_simulation_configuration_field",
        message: `Unsupported simulator configuration field: ${key}`,
      });
    }
  }

  const feeResult = validateFeeConfiguration(record.fees);
  if (feeResult.status === "invalid") {
    issues.push(
      ...feeResult.issues.map(({ path, message }) => ({
        code: "invalid_simulation_fees",
        message: `Invalid simulator fee configuration at ${path}: ${message}`,
      })),
    );
  }
  const migrationResult = validateMigrationConfiguration(record.migration);
  if (migrationResult.status === "invalid") {
    issues.push(
      ...migrationResult.issues.map(({ path, message }) => ({
        code: "invalid_simulation_migration",
        message: `Invalid simulator migration configuration at ${path}: ${message}`,
      })),
    );
  }

  if (record.supplyMode !== "fixed" && record.supplyMode !== "dynamic") {
    issues.push({
      code: "invalid_simulation_supply_mode",
      message: "Simulator supply mode must be fixed or dynamic",
    });
  }
  const clock = readClock(record.clock);
  if (!clock)
    issues.push({
      code: "invalid_simulation_clock",
      message: "Simulator clock requires non-negative slot and timestamp bigints",
    });
  if (typeof record.activationPoint !== "bigint" || record.activationPoint < 0n) {
    issues.push({
      code: "invalid_simulation_activation_point",
      message: "Simulator activation point must be a non-negative bigint",
    });
  }
  if (record.activationType !== "slot" && record.activationType !== "timestamp") {
    issues.push({
      code: "invalid_simulation_activation_type",
      message: "Simulator activation type must be slot or timestamp",
    });
  }

  const dynamicFeeState = readDynamicFeeState(record.dynamicFeeState);
  if (record.dynamicFeeState !== undefined && !dynamicFeeState) {
    issues.push({
      code: "invalid_initial_dynamic_fee_state",
      message:
        "Initial dynamic-fee state must contain non-negative bigint values and a positive Q64.64 reference price",
    });
  }
  const fees = feeResult.status === "valid" ? feeResult.value : undefined;
  if (fees?.dynamic && !dynamicFeeState) {
    issues.push({
      code: "missing_initial_dynamic_fee_state",
      message:
        "Dynamic fees require an explicit initial dynamic-fee state for deterministic solver verification",
    });
  }
  if (!fees?.dynamic && dynamicFeeState) {
    issues.push({
      code: "unexpected_initial_dynamic_fee_state",
      message: "Initial dynamic-fee state requires a dynamic-fee configuration",
    });
  }

  if (issues.length > 0 || !fees || migrationResult.status !== "valid" || !clock) {
    return { status: "invalid", issues };
  }
  return {
    status: "valid",
    value: {
      fees,
      migration: migrationResult.value,
      supplyMode: record.supplyMode as "fixed" | "dynamic",
      clock,
      activationPoint: record.activationPoint as bigint,
      activationType: record.activationType as FeeClock,
      ...(dynamicFeeState ? { dynamicFeeState } : {}),
    },
  };
}

export function verifyCandidateWithDeterministicSimulator(
  input: Readonly<{
    candidateId: string;
    market: NormalizedMarketIntent;
    curve: DbcCurve;
    configuration: SolverSimulationConfiguration;
  }>,
): SolverSimulationVerificationResult {
  const configurationValidation = validateSolverSimulationConfiguration(input.configuration);
  if (configurationValidation.status === "invalid") {
    return { status: "invalid", issues: configurationValidation.issues };
  }
  const configuration = configurationValidation.value;
  const initialState = createInitialPoolState(input.market, input.curve, configuration);
  const stateValidation = validatePoolState(initialState);
  if (stateValidation.status === "invalid") {
    return {
      status: "invalid",
      issues: stateValidation.issues.map(({ path, message }) => ({
        code: "invalid_simulator_initial_state",
        message: `Invalid deterministic simulator initial state at ${path}: ${message}`,
      })),
    };
  }

  const terminalSqrtPrice = input.curve.segments.at(-1)?.upperSqrtPriceQ64x64;
  if (terminalSqrtPrice === undefined) {
    return {
      status: "invalid",
      issues: [
        {
          code: "missing_terminal_price",
          message: "Candidate curve has no terminal price boundary",
        },
      ],
    };
  }

  let upperQuote: ReturnType<typeof quoteBuy>;
  try {
    upperQuote = quoteBuy(MAX_CURVE_U64, initialState);
  } catch (error) {
    return {
      status: "invalid",
      issues: [{ code: "deterministic_quote_failed", message: errorMessage(error) }],
    };
  }
  if (upperQuote.nextSqrtPriceQ64x64 !== terminalSqrtPrice) {
    return {
      status: "invalid",
      issues: [
        {
          code: "curve_not_reachable",
          message:
            "The deterministic simulator cannot reach the candidate curve's terminal price with a u64 quote input",
        },
      ],
    };
  }

  let lower = 1n;
  let upper = MAX_CURVE_U64;
  try {
    while (lower < upper) {
      const middle = (lower + upper) / 2n;
      const quote = quoteBuy(middle, initialState);
      if (quote.nextSqrtPriceQ64x64 === terminalSqrtPrice) upper = middle;
      else lower = middle + 1n;
    }
  } catch (error) {
    return {
      status: "invalid",
      issues: [{ code: "deterministic_search_failed", message: errorMessage(error) }],
    };
  }

  let simulation: DeterministicSimulationResult;
  try {
    simulation = runDeterministicSimulation({
      id: `solver-${input.candidateId}`,
      initialState: stateValidation.value,
      trades: [{ direction: "buy", inputAtomic: lower, clock: configuration.clock }],
    });
  } catch (error) {
    return {
      status: "invalid",
      issues: [{ code: "deterministic_simulation_failed", message: errorMessage(error) }],
    };
  }

  const expectedQuoteAtomic = quoteRequiredForSegments(input.curve.segments);
  const expectedBaseAtomic = baseDistributedForSegments(input.curve.segments);
  const expectedBaseBps = (expectedBaseAtomic * 10_000n) / input.market.totalBaseAtomic;
  const mismatches: string[] = [];
  if (simulation.finalState.migrationProgress !== "curve-complete") {
    mismatches.push("simulator did not reach the migration threshold");
  }
  if (simulation.finalState.currentSqrtPriceQ64x64 !== terminalSqrtPrice) {
    mismatches.push("terminal Q64.64 price differs");
  }
  if (simulation.metrics.quoteAccumulated.amount.raw !== expectedQuoteAtomic) {
    mismatches.push("quote-to-migration amount differs");
  }
  if (simulation.metrics.baseDistributed.amount.raw !== expectedBaseAtomic) {
    mismatches.push("base-distribution amount differs");
  }
  if (simulation.metrics.baseDistributedBps !== expectedBaseBps) {
    mismatches.push("base-distribution percentage differs");
  }
  if (mismatches.length > 0) {
    return {
      status: "invalid",
      issues: [
        {
          code: "deterministic_simulation_mismatch",
          message: `Deterministic simulator mismatch for candidate ${input.candidateId}: ${mismatches.join(", ")}`,
        },
      ],
    };
  }

  return { status: "verified", simulation };
}

function createInitialPoolState(
  market: NormalizedMarketIntent,
  curve: DbcCurve,
  configuration: SolverSimulationConfiguration,
): PoolState {
  const baseZero = currencyAmount(0n, curve.baseDecimals);
  const quoteZero = currencyAmount(0n, curve.quoteDecimals);
  const baseSupply = currencyAmount(market.totalBaseAtomic, curve.baseDecimals);
  const pair = { base: baseZero, quote: quoteZero };
  const quoteAmount = { asset: "quote" as const, amount: quoteZero };
  const baseAmount = { asset: "base" as const, amount: baseZero };
  return {
    curve,
    fees: configuration.fees,
    migration: configuration.migration,
    supply: {
      mode: configuration.supplyMode,
      totalBaseSupply: { asset: "base", amount: baseSupply },
      baseDistributed: baseAmount,
    },
    ledger: {
      pool: { base: baseSupply, quote: quoteZero },
      fees: {
        totalTrading: pair,
        protocol: pair,
        partner: pair,
        creator: pair,
        referral: pair,
      },
      surplus: { protocol: quoteAmount, partner: quoteAmount, creator: quoteAmount },
      migration: {
        partnerFee: quoteAmount,
        creatorFee: quoteAmount,
        protocolLiquidityFee: pair,
        dammLiquidity: pair,
      },
      leftoverBase: baseAmount,
    },
    currentSqrtPriceQ64x64: curve.startSqrtPriceQ64x64,
    clock: configuration.clock,
    activationPoint: configuration.activationPoint,
    activationType: configuration.activationType,
    migrationProgress: "bonding",
    hasSwapped: false,
    ...(configuration.dynamicFeeState ? { dynamicFeeState: configuration.dynamicFeeState } : {}),
  };
}

function invalidConfiguration(
  code: string,
  message: string,
): SolverSimulationConfigurationValidationResult {
  return { status: "invalid", issues: [{ code, message }] };
}

function readClock(value: unknown): SimulationClock | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "slot" && key !== "timestampSeconds") ||
    typeof record.slot !== "bigint" ||
    record.slot < 0n ||
    typeof record.timestampSeconds !== "bigint" ||
    record.timestampSeconds < 0n
  ) {
    return undefined;
  }
  return { slot: record.slot, timestampSeconds: record.timestampSeconds };
}

function readDynamicFeeState(value: unknown): DynamicFeeState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          "lastUpdateTimestamp",
          "sqrtPriceReferenceQ64x64",
          "volatilityAccumulator",
          "volatilityReference",
        ].includes(key),
    ) ||
    typeof record.lastUpdateTimestamp !== "bigint" ||
    record.lastUpdateTimestamp < 0n ||
    typeof record.sqrtPriceReferenceQ64x64 !== "bigint" ||
    record.sqrtPriceReferenceQ64x64 <= 0n ||
    typeof record.volatilityAccumulator !== "bigint" ||
    record.volatilityAccumulator < 0n ||
    typeof record.volatilityReference !== "bigint" ||
    record.volatilityReference < 0n
  ) {
    return undefined;
  }
  return {
    lastUpdateTimestamp: record.lastUpdateTimestamp,
    sqrtPriceReferenceQ64x64: record.sqrtPriceReferenceQ64x64,
    volatilityAccumulator: record.volatilityAccumulator,
    volatilityReference: record.volatilityReference,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Deterministic candidate verification failed";
}
