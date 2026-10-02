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
export { quoteBuy as quoteCurveBuy, quoteSell as quoteCurveSell } from "./domain/curve-swap.js";
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
  LiquidityAllocationAmounts,
  PostMigrationLiquidityAllocation,
} from "./domain/migration-allocation.js";
export {
  calculatePostMigrationLiquidityAllocation,
  LIQUIDITY_ALLOCATION_DENOMINATOR_BPS,
} from "./domain/migration-allocation.js";
export type {
  AssetAmount,
  AssetAmountPair,
  AssetSide,
  DynamicFeeState,
  EconomicLedger,
  PoolEconomicSnapshot,
  PoolState,
  PoolSupplyState,
  SimulationClock,
} from "./domain/pool-state.js";
export type { PoolStateValidationResult } from "./domain/pool-state-validation.js";
export { validatePoolState } from "./domain/pool-state-validation.js";
export type {
  MigrationExecutionResult,
  MigrationSettlement,
} from "./domain/simulator.js";
export {
  executeBuy,
  executeMigration,
  executeSell,
  getPoolEconomicSnapshot,
  getMigrationProgress,
  getSpotPrice,
  quoteBuy,
  quoteSell,
  runDeterministicSimulation,
} from "./domain/simulator.js";
export type {
  DeterministicSimulationInput,
  DeterministicTradeInput,
} from "./domain/simulator.js";
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
  CandidateConstraintAssessment,
  ConstraintConflictInput,
  SolvedMarketCandidate,
  SolverAlternative,
  SolverConstraintCode,
  SolverExplanation,
  SolverMetricSet,
  SolverExplanationEvidence,
  SolverResult,
  SolverWarning,
  SolverWarningCode,
} from "./domain/solver-result.js";
export { createConstraintConflictWarning, deriveSolverStatus } from "./domain/solver-result.js";
export type { CandidateLiquidityExplanationInput } from "./domain/solver-explanations.js";
export { explainCandidateLiquidity } from "./domain/solver-explanations.js";
export type {
  CandidateAttackExposure,
  CandidateAttackExposureEvaluator,
  CandidatePriceImpactEvaluator,
  CandidatePriceImpactMeasurement,
  InverseCurveCandidate,
  InverseCurveSolverIssue,
  InverseCurveSolverOptions,
  InverseCurveSolverResult,
} from "./domain/inverse-curve-solver.js";
export { solveMarketCurve } from "./domain/inverse-curve-solver.js";
export type {
  SolverSimulationConfiguration,
  SolverSimulationConfigurationIssue,
  SolverSimulationConfigurationValidationResult,
  SolverSimulationVerificationResult,
} from "./domain/solver-deterministic-verification.js";
export {
  validateSolverSimulationConfiguration,
  verifyCandidateWithDeterministicSimulator,
} from "./domain/solver-deterministic-verification.js";
export type {
  SdkCurveValidationEvidence,
  SdkCurveValidationIssue,
  SdkCurveValidationResult,
} from "./domain/solver-sdk-validation.js";
export {
  PINNED_METEORA_DBC_SDK_VERSION,
  validateSolverCandidateCurveWithSdk,
} from "./domain/solver-sdk-validation.js";
export type {
  SolverRunCandidate,
  SolverRunIssue,
  SolverRunJsonObject,
  SolverRunJsonValue,
  SolverRunRecord,
} from "./domain/solver-run-record.js";
export { createSolverRunRecord } from "./domain/solver-run-record.js";
export type {
  SolverObjectiveEvaluation,
  SolverObjectiveMeasurements,
  SolverObjectiveTerm,
  SolverObjectiveTermResult,
  SolverObjectiveWeights,
} from "./domain/solver-objective.js";
export {
  evaluateSolverObjective,
  SOLVER_OBJECTIVE_TERMS,
} from "./domain/solver-objective.js";
export type {
  RankableSolverCandidate,
  SolverCandidateRankingResult,
} from "./domain/solver-candidate-ranking.js";
export { rankSolverCandidates } from "./domain/solver-candidate-ranking.js";
export {
  generateInitialPriceBreakpoints,
  initialCandidateSegmentCount,
} from "./domain/solver-candidate-generation.js";
export type { SegmentLiquiditySolution } from "./domain/solver-liquidity.js";
export {
  solveSegmentLiquidityForBaseTarget,
  solveSegmentLiquidityForQuoteTarget,
} from "./domain/solver-liquidity.js";
export type {
  CandidateCurveDraft,
  CandidateCurveIssue,
  CandidateCurveValidationResult,
} from "./domain/solver-candidate-validation.js";
export { validateCandidateCurve } from "./domain/solver-candidate-validation.js";
export type {
  DeterministicCoordinateSearchOptions,
  DeterministicObjective,
  DeterministicOptimizationResult,
  OptimizationDimension,
  OptimizedValue,
} from "./domain/deterministic-optimizer.js";
export { deterministicCoordinateSearch } from "./domain/deterministic-optimizer.js";
export type {
  NormalizedSolverInput,
  SolverInput,
  SolverInputIssue,
  SolverInputValidationResult,
} from "./domain/solver-input.js";
export { normalizeSolverInput } from "./domain/solver-input.js";
export type { SolverStatus, ValidationStatus, VerificationStatus } from "./domain/status.js";
export type {
  BuyResult,
  SellResult,
  TradeFeeAmounts,
  TradeFillStatus,
  TradeMetrics,
  TradeResult,
  TradeResultBase,
} from "./domain/trade-result.js";
