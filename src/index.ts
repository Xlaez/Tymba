export type {
  AttackFailure,
  AttackResult,
  AttackRunMetadata,
  AttackRunStatus,
  AttackScenario,
  CompletedAttackResult,
  FailedAttackResult,
  FeeScheduleTimingMetrics,
  FeeScheduleTimingResult,
  OpeningSniperMetrics,
  OpeningSniperResult,
  PumpAndDumpMetrics,
  PumpAndDumpResult,
  SellCascadeMetrics,
  SellCascadeResult,
  WhaleEntryMetrics,
  WhaleEntryResult,
} from "./domain/attack-result.js";
export type {
  AuditEvidence,
  AuditEvidenceSource,
  AuditEvidenceValue,
  AuditFinding,
  AuditFindingCategory,
  AuditSeverity,
} from "./domain/audit.js";
export type {
  ConfigurationValidationIssue,
  ConfigurationValidationResult,
  FeeConfigurationValidationResult,
  MigrationConfigurationValidationResult,
} from "./domain/configuration-validation.js";
export {
  validateFeeConfiguration,
  validateMigrationConfiguration,
} from "./domain/configuration-validation.js";
export type { AmountRounding, CurrencyAmount } from "./domain/currency-amount.js";
export {
  currencyAmount,
  formatCurrencyAmount,
  MAX_CURRENCY_DECIMALS,
  parseCurrencyAmount,
  rescaleCurrencyAmount,
} from "./domain/currency-amount.js";
export type {
  CurveSegment,
  CurveShapeIssue,
  CurveShapeValidationResult,
  DbcCurve,
} from "./domain/curve.js";
export {
  MAX_CURVE_U64,
  MAX_CURVE_U128,
  MAX_PUBLIC_BUILDER_CURVE_ENTRIES,
  MAX_PUBLIC_BUILDER_SEGMENTS,
  MAX_PUBLIC_BUILDER_SQRT_PRICE_BOUNDARIES,
  validateDbcCurveShape,
} from "./domain/curve.js";
export type { CurveSwapQuote } from "./domain/curve-swap.js";
export { quoteBuy, quoteSell } from "./domain/curve-swap.js";
export type {
  DeploymentApproval,
  DeploymentMismatch,
  DeploymentRecord,
  DeploymentStatus,
  DeploymentVerification,
  DeploymentVerificationStatus,
} from "./domain/deployment-record.js";
export type { AppliedTradingFee, FeePlacement, TradeDirection } from "./domain/fee-math.js";
export {
  DBC_FEE_DENOMINATOR,
  DBC_FEE_NUMERATOR_PER_BPS,
  feeNumeratorFromBps,
  feeOnIncludedAmount,
  grossUpExcludedAmount,
  MAX_DBC_FEE_NUMERATOR,
  resolveFeePlacement,
} from "./domain/fee-math.js";
export type {
  BaseFeeSchedule,
  DynamicFeeConfiguration,
  FeeClock,
  FeeCollectionMode,
  FeeConfiguration,
  FixedBaseFeeSchedule,
  MigratedPoolFeeConfiguration,
  ScheduledBaseFee,
} from "./domain/fees.js";
export type {
  AssetDefinition,
  DecimalString,
  MarketIntent,
  MarketIntentIssue,
  MarketIntentValidationResult,
  NormalizedMarketIntent,
} from "./domain/market-intent.js";
export { validateMarketIntent } from "./domain/market-intent.js";
export type {
  LiquidityAllocation,
  LiquidityAllocationShare,
  MigrationAllocationIntent,
  MigrationConfiguration,
  MigrationDestination,
  MigrationFeeConfiguration,
  MigrationProgress,
} from "./domain/migration.js";
export type { MigrationQuoteAccounting } from "./domain/migration-math.js";
export {
  calculateMigrationQuoteAccounting,
  MIGRATION_PROGRESS_DENOMINATOR_BPS,
  MIGRATION_SURPLUS_PARTNER_CREATOR_PERCENT,
  MIGRATION_SURPLUS_PROTOCOL_PERCENT,
  migrationSqrtPriceAtThreshold,
} from "./domain/migration-math.js";
export type {
  AssetAmount,
  AssetAmountPair,
  AssetSide,
  DynamicFeeState,
  EconomicLedger,
  PoolState,
  PoolSupplyState,
  SimulationClock,
} from "./domain/pool-state.js";
export {
  priceToSqrtPriceQ64x64,
  Q64_ONE,
  Q128_SCALE,
  sqrtPriceQ64x64ToPrice,
} from "./domain/price.js";
export {
  baseDistributedForSegment,
  baseDistributedForSegments,
  baseRequiredForSegment,
  quoteDistributedForSegment,
  quoteRequiredForSegment,
  quoteRequiredForSegments,
  sqrtPriceAfterBaseInput,
  sqrtPriceAfterBaseOutput,
  sqrtPriceAfterQuoteInput,
  sqrtPriceAfterQuoteOutput,
} from "./domain/segment-math.js";
export type {
  AgentArchetype,
  AgentCounts,
  DeterministicSimulationMetrics,
  DeterministicSimulationResult,
  DistributionSummary,
  FailedSimulationResult,
  SimulationFailure,
  SimulationKind,
  SimulationResult,
  SimulationRunMetadata,
  SimulationRunStatus,
  StochasticSimulationResult,
  StochasticSimulationSummary,
} from "./domain/simulation.js";
export type {
  SolvedMarketCandidate,
  SolverExplanation,
  SolverMetricSet,
  SolverResult,
  SolverWarning,
  SolverWarningCode,
} from "./domain/solver-result.js";
export type { SolverStatus, ValidationStatus, VerificationStatus } from "./domain/status.js";
export type {
  BuyResult,
  SellResult,
  TradeFeeAmounts,
  TradeFillStatus,
  TradeResult,
  TradeResultBase,
} from "./domain/trade-result.js";
