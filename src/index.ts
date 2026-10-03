export type {
  AttackFailure,
  AttackIterationOutcome,
  AttackResult,
  AttackRunMetadata,
  AttackRunStatus,
  AttackScenario,
  CompletedAttackResult,
  FailedAttackResult,
  FailedFeeScheduleTimingResult,
  FeeScheduleCandidateOutcome,
  FeeScheduleTimingRunMetadata,
  FeeScheduleTimingMetrics,
  FeeScheduleTimingResult,
  OpeningSniperMetrics,
  OpeningSniperResult,
  PumpAndDumpMetrics,
  PumpAndDumpResult,
  SellCascadeMetrics,
  SellCascadeResult,
  SeededAttackScenario,
  WhaleEntryMetrics,
  WhaleEntryResult,
} from "./domain/attack-result.js";
export type {
  AuditAnalysisStatus,
  AuditCategoryResult,
  AuditEvidence,
  AuditEvidenceSource,
  AuditEvidenceValue,
  AuditFinding,
  AuditFindingCategory,
  AuditMetricObservation,
  AuditSeverity,
  PriceStabilityAuditResult,
} from "./domain/audit.js";
export type {
  ConcentrationAuditInput,
  ConcentrationAuditResult,
} from "./domain/concentration-audit.js";
export { analyzeConcentration } from "./domain/concentration-audit.js";
export type {
  AuditSeverityAssessment,
  AuditSeverityMetric,
  AuditSeverityPolicy,
  AuditSeverityThreshold,
} from "./domain/audit-policy.js";
export {
  assessAuditSeverity,
  AUDIT_SEVERITY_METRICS,
  DEMO_AUDIT_SEVERITY_POLICY,
  validateAuditSeverityPolicy,
} from "./domain/audit-policy.js";
export type { PriceStabilityAuditInput } from "./domain/price-stability-audit.js";
export { analyzePriceStability } from "./domain/price-stability-audit.js";
export type {
  EarlyAdvantageAuditInput,
  EarlyAdvantageAuditResult,
} from "./domain/early-advantage-audit.js";
export { analyzeEarlyAdvantage } from "./domain/early-advantage-audit.js";
export type {
  OpeningSniperAuditRun,
  SniperExposureAuditInput,
  SniperExposureAuditResult,
} from "./domain/sniper-exposure-audit.js";
export { analyzeSniperExposure } from "./domain/sniper-exposure-audit.js";
export type {
  ExitLiquidityAuditInput,
  ExitLiquidityAuditResult,
} from "./domain/exit-liquidity-audit.js";
export { analyzeExitLiquiditySensitivity } from "./domain/exit-liquidity-audit.js";
export type {
  LateStageCapitalStressPair,
  MigrationFragilityAuditInput,
  MigrationFragilityAuditResult,
} from "./domain/migration-fragility-audit.js";
export { analyzeMigrationFragility } from "./domain/migration-fragility-audit.js";
export type {
  FeeShockAuditInput,
  FeeShockAuditResult,
  FeeShockAuditRun,
} from "./domain/fee-shock-audit.js";
export { analyzeFeeShock } from "./domain/fee-shock-audit.js";
export type {
  SurplusBehaviorAuditInput,
  SurplusBehaviorAuditResult,
} from "./domain/surplus-behavior-audit.js";
export { analyzeSurplusBehavior } from "./domain/surplus-behavior-audit.js";
export type {
  PostMigrationLiquidityAuditInput,
  PostMigrationLiquidityAuditResult,
} from "./domain/post-migration-liquidity-audit.js";
export { analyzePostMigrationLiquidity } from "./domain/post-migration-liquidity-audit.js";
export type {
  AuditSolverFindingMapping,
  AuditSolverObjectiveConversion,
  AuditSolverRiskTerm,
  ConvertAuditFindingsToSolverObjectiveInput,
  UnsupportedAuditSolverFinding,
  UnsupportedAuditSolverRiskTerm,
} from "./domain/audit-solver-objective.js";
export { convertAuditFindingsToSolverObjective } from "./domain/audit-solver-objective.js";
export type {
  GenerateHardenedCandidateInput,
  HardenedCandidateGenerationIssue,
  HardenedCandidateGenerationResult,
  RejectedHardenedCandidate,
} from "./domain/harden-market-candidate.js";
export { generateHardenedCandidate } from "./domain/harden-market-candidate.js";
export type {
  AttackReplayAttempt,
  CandidateResimulationResult,
  HardeningAttackReplayConfiguration,
  HardeningReplayConfiguration,
  HardeningResimulationResult,
  ReplayAttempt,
  ReplayFailure,
} from "./domain/harden-market-resimulation.js";
export { resimulateHardenedCandidate } from "./domain/harden-market-resimulation.js";
export type {
  HardeningComparisonCategory,
  HardeningComparisonDirection,
  HardeningComparisonStatus,
  HardeningComparisonValue,
  HardeningMetricComparison,
  HardenedCandidateComparison,
} from "./domain/harden-market-comparison.js";
export { compareHardenedCandidate } from "./domain/harden-market-comparison.js";
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
  getScheduledBaseFeeNumeratorAtClock,
  getPoolEconomicSnapshot,
  getMigrationProgress,
  getSpotPrice,
  quoteBuy,
  quoteSell,
  runDeterministicSimulation,
} from "./domain/simulator.js";
export {
  DBC_SIMULATION_ENGINE_VERSION,
  PINNED_SIMULATION_SDK_VERSION,
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
  EarlyParticipantAdvantageMetrics,
  MigrationSurplusMetrics,
  DeterministicSimulationMetrics,
  DeterministicSimulationResult,
  DistributionSummary,
  FailedDeterministicSimulationResult,
  FailedSimulationResult,
  FailedStochasticSimulationResult,
  SimulationFailure,
  SimulationKind,
  SimulationResult,
  SimulationRunMetadata,
  SimulationRunStatus,
  SimulationUncertainty,
  SimulationUncertaintyLabel,
  SimulationUncertaintyReason,
  StochasticIterationOutcome,
  StochasticSimulationResult,
  StochasticSimulationSummary,
} from "./domain/simulation.js";
export type { SeededRandom, SeededRunMetadata } from "./domain/seeded-random.js";
export {
  createSeededRandom,
  createSeededRunMetadata,
  SEEDED_RANDOM_ALGORITHM,
  SEEDED_RANDOM_MAX_SEED,
  SEEDED_RANDOM_UINT64_RANGE,
} from "./domain/seeded-random.js";
export type {
  AgentPortfolioObservation,
  AgentPortfolioResult,
  SimulationAgentObservation,
  SimulationAction,
  SimulationAgent,
  SimulationObservation,
  SimulationExecutionOrder,
  StochasticSimulationEvent,
  StochasticSimulationInput,
  StochasticSimulationTrace,
  StochasticTickConfiguration,
} from "./domain/stochastic-simulation.js";
export { runStochasticSimulationTrace } from "./domain/stochastic-simulation.js";
export type {
  AgentFunding,
  MvpAgentConfigurationMap,
  MvpAgentConfiguration,
  MomentumTraderConfiguration,
  PanicSellerConfiguration,
  ProfitTakerConfiguration,
  RandomTraderConfiguration,
  RetailBuyerConfiguration,
  SniperConfiguration,
  WhaleConfiguration,
} from "./domain/simulation-agents.js";
export { createMvpAgent } from "./domain/simulation-agents.js";
export type {
  AgentDistributionConfiguration,
  AgentPopulation,
  StochasticScenarioConfiguration,
} from "./domain/simulation-scenario.js";
export {
  createMvpAgentPopulation,
  createStochasticSimulationInput,
  MAX_MVP_AGENT_POPULATION,
} from "./domain/simulation-scenario.js";
export type { MonteCarloSimulationInput } from "./domain/monte-carlo.js";
export { MAX_MVP_MONTE_CARLO_ITERATIONS, runMonteCarloSimulation } from "./domain/monte-carlo.js";
export type { OpeningSniperAttackInput } from "./domain/attacks/opening-sniper.js";
export { runOpeningSniperAttack } from "./domain/attacks/opening-sniper.js";
export type { WhaleEntryAttackInput } from "./domain/attacks/whale-entry.js";
export { runWhaleEntryAttack } from "./domain/attacks/whale-entry.js";
export type { PumpAndDumpAttackInput } from "./domain/attacks/pump-and-dump.js";
export { runPumpAndDumpAttack } from "./domain/attacks/pump-and-dump.js";
export type { SellCascadeAttackInput } from "./domain/attacks/sell-cascade.js";
export { runSellCascadeAttack } from "./domain/attacks/sell-cascade.js";
export type { FeeScheduleTimingAttackInput } from "./domain/attacks/fee-schedule-timing.js";
export { runFeeScheduleTimingAttack } from "./domain/attacks/fee-schedule-timing.js";
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
