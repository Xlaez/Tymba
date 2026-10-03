# Tymba MVP Build Plan

This is the working checklist for the Tymba MVP. Complete phases in order unless a task is explicitly marked as parallel. Check an item only when its acceptance criteria are met and the result is documented or tested.

## Product outcome

Deliver a reproducible demo in which a user can:

```text
Describe → Compile → Explain → Simulate → Attack → Audit → Harden → Deploy
```

The MVP must turn an economic launch intent into a valid Meteora DBC candidate, verify its behavior, test it against adversarial scenarios, show measurable risks and improvements, and deploy the approved result to Meteora devnet with post-deployment verification.

## Working rules

- [ ] Read `spec.md`, `PRD.md`, and `AGENTS.md` before each implementation slice.
- [ ] Treat the currently deployed Meteora program and official SDK as authoritative.
- [ ] Record unresolved protocol assumptions instead of silently implementing them.
- [ ] Build and verify domain mathematics before building the web experience.
- [ ] Use exact integer or documented fixed-point arithmetic for on-chain quantities.
- [ ] Make solver and simulation runs reproducible from inputs and a stored random seed.
- [ ] Label deterministic calculations, simulations, adversarial models, and on-chain observations separately.
- [ ] Never describe modeled results as guarantees.

## Phase 0 — Confirm scope and initialize the workspace

Goal: turn the empty specification workspace into a minimal, testable engineering workspace.

### Repository and tooling

- [x] Decide and document the initial package manager and TypeScript runtime.
- [x] Initialize the root package configuration.
- [x] Initialize Git and create the initial repository baseline.
- [x] Add TypeScript configuration with strict type checking.
- [x] Add formatter and linter configuration.
- [x] Add a test runner and coverage command.
- [x] Add a root `README.md` with setup and verification commands.
- [x] Add `.gitignore` and environment-variable documentation.
- [x] Add the first CI/check command that runs formatting, linting, type checking, and tests.

### Product decisions to lock before coding

- [x] Confirm the quote semantics (USD-stable/USDC), base decimals (9), quote decimals (6), and atomic amount conventions (`bigint`) for the first demo profile.
- [x] Confirm whether the first CLI and domain packages will be a small single package or a monorepo.
- [x] Define the supported MVP intent fields and which fields are deferred, using `PRD.md` as the MVP boundary.
- [x] Define the first supported Meteora network: devnet only for MVP deployment.
- [x] Define parity policy: exact atomic/Q64.64 equality by default; at most one atomic unit for an evidence-backed, helper-specific exception.
- [x] Create a decision log for all unresolved Meteora questions.

### Phase gate

- [x] A frozen-lockfile install succeeds and the configured check passes with the currently empty test suite.
- [x] The repository has one documented command for format, lint, type check, and test.
- [x] No protocol behavior is implemented from an unverified assumption.

## Phase 1 — Verify Meteora behavior and establish domain contracts

Goal: create a verified protocol boundary before writing the solver.

### SDK and protocol research

- [x] Select and pin `@meteora-ag/dynamic-bonding-curve-sdk` at exactly `1.5.13`.
- [x] Record the DBC and DAMM v2 program IDs and pool authorities from current Meteora developer documentation.
- [x] Verify curve-point representation, price scale, liquidity representation, and decimal conversion against pinned SDK declarations; preserve exact rounding/program parity as a Phase 2 test obligation.
- [x] Verify the public-builder limit (16 curve entries/segments) and legacy stored capacity (20 entries) from current official docs/source.
- [x] Verify that N boundary prices compile to N−1 curve entries/segments; 16 entries require 17 boundary prices including the start.
- [x] Verify documented fixed versus dynamic supply behavior and leftover lifecycle; exact supply inequalities and atomic accounting remain a parity-test obligation.
- [x] Verify documented and source-visible scheduler/dynamic-fee behavior and clock semantics; exact fixed-point/fee-split parity remains a test obligation.
- [x] Verify documented migration threshold, overshoot, surplus, and recipient behavior; exact split/fee rounding remains a parity-test obligation.
- [x] Verify documented post-migration liquidity allocation, locking, vesting, and partner/creator ownership; exact atomic allocation remains a parity-test obligation.
- [x] Verify config immutability and live-pool/token authority boundaries against the pinned SDK IDL and current Meteora docs; re-check if the deployed program/SDK changes.
- [x] Map pinned SDK helpers for curve construction, quoting, validation, RPC reads, and transaction construction to the future adapter boundary; signing/submission remain explicit Tymba responsibilities.
- [x] Identify Circle Devnet USDC as the leading six-decimal, faucet-backed quote-mint candidate; full DBC-to-DAMM v2 support remains unverified.
- [ ] Verify the candidate mint on devnet and complete an explicitly approved DBC-to-DAMM v2 integration run before adopting it.
- [x] Verify the pinned SDK/program's Token-2022, token-badge, and transfer-hook paths and migration/authority constraints; keep transfer hooks outside MVP core and avoid blanket Token-2022 extension claims.
- [x] Capture currently verified sources, SDK references, example values, and known limitations in `PROTOCOL_NOTES.md`.

### Domain types

- [x] Define `CurrencyAmount` and exact decimal-string parse/format rules; require explicit rounding when reducing precision (`src/domain/currency-amount.ts`).
- [x] Define the canonical decimal-string `MarketIntent`, validate alternatives/conflicts, and normalize to exact atomic and arbitrary-precision values (`src/domain/market-intent.ts`).
- [x] Define and structurally validate `CurveSegment`/`DbcCurve` with Q64.64 `bigint` boundaries, u128 liquidity, u64 quote threshold, and the 16-segment public-builder limit (`src/domain/curve.ts`).
- [x] Define fee, migration, allocation, solver result, and warning types (`src/domain/fees.ts`, `src/domain/migration.ts`, `src/domain/solver-result.ts`).
- [x] Define deterministic pool state and trade-result types (`src/domain/pool-state.ts`, `src/domain/trade-result.ts`).
- [x] Define simulation, attack, audit finding, and deployment-record types (`src/domain/simulation.ts`, `src/domain/attack-result.ts`, `src/domain/audit.ts`, `src/domain/deployment-record.ts`); document canonical contracts in `spec.md` §20.
- [x] Define explicit status values for validation, solver outcomes, and verification evidence (`src/domain/status.ts`).

### Phase gate

- [x] Protocol notes distinguish source-backed facts from unresolved behavior and map remaining math/deployment questions to explicit parity or devnet verification gates; documentation alone does not count as parity evidence.
- [x] Domain types do not depend on UI, database, LLM, wallet, SDK, or network code.
- [x] Add pure runtime validators for fee configurations, migration fees, allocation intent, and six DAMM v2 liquidity buckets, including supported units, ranges, sums, and integer bounds (`src/domain/configuration-validation.ts`).

## Phase 2 — Implement and verify DBC math

Goal: build the smallest trustworthy mathematical core.

### Core calculations

- [x] Implement human-price ↔ Q64.64 conversion with exact decimal-rational quantization, floor rounding, and explicit asset decimal scales (`src/domain/price.ts`).
- [x] Implement quote required to traverse one segment.
- [x] Implement base tokens distributed through one segment.
- [x] Implement inverse/reverse calculations needed for verification.
- [x] Implement multi-segment quote accumulation.
- [x] Implement multi-segment base distribution.
- [x] Implement buy quoting across segment boundaries.
- [x] Implement sell quoting across segment boundaries.
- [x] Implement explicit fixed-fee application and rounding behavior; scheduled/dynamic fee-rate selection remains deferred.
- [x] Implement migration threshold price, quote progress, completion, overshoot, and verified aggregate surplus shares; exact creator/partner surplus split remains unresolved.
- [x] Implement post-migration DAMM liquidity-unit allocation accounting with the program's exact per-bucket rounding (`src/domain/migration-allocation.ts`).

### Tests and parity

- [x] Add known-value unit tests for every implemented core formula.
- [x] Add tests for exact segment-boundary trades.
- [x] Add tests for trades spanning multiple segments.
- [x] Add fixed-fee buy/sell tests for quote-token and output-token fee collection.
- [x] Add property tests for increasing liquidity reducing price movement for fixed input.
- [x] Add property tests for monotonic price progression and valid segment ordering.
- [x] Add buy-then-sell reversibility tests with documented fee and integer-rounding effects.
- [x] Add tests that multi-segment totals equal the sum of individually rounded segment calculations.
- [x] Generate SDK curve-valid configurations and require exact local-to-SDK equality for protocol outputs.
- [x] Verify raw Q64.64 price boundaries pass unchanged through the pinned SDK custom-sqrt-price builder; do not assume parity with its finite-precision price convenience helper.
- [x] Keep exact parity as the default; no one-atomic-unit exception is currently authorized or used.
- [x] Test human-readable price formatting separately from SDK protocol parity.
- [x] Document the intentional SDK convenience-helper difference and state that it receives no parity tolerance.
- [x] Verify post-migration liquidity bucket order, floors, and creator-unlocked remainder against Meteora program source; validate the six-share sum against the pinned SDK.

### Phase gate

- [x] The implemented Phase 2 math surface passes unit, property, and pinned-SDK parity tests.
- [x] Every on-chain quantity computed by the implemented Phase 2 math has an explicit precision and rounding policy.
- [x] No solver or UI work has proceeded while a core parity discrepancy remains unexplained.
- [x] All Phase 2 MVP core calculations, including post-migration liquidity allocation accounting, are implemented and verified before Phase 3 begins.

## Phase 3 — Build the deterministic simulator and CLI

Goal: expose the verified math through a complete in-memory pool model and the first user-facing milestone.

### Simulator

- [x] Define and validate the complete in-memory pool state, including exact asset scales, bounded atomic amounts, curve price bounds, supply coherence, and optional dynamic-fee state (`src/domain/pool-state-validation.ts`).
- [x] Implement `quoteBuy`, `quoteSell`, `executeBuy`, and `executeSell`.
- [x] Track reserves, distributed base, fees, spot price, and migration progress.
- [x] Support trades that cross any valid number of configured segments.
- [x] Model migration and prevent invalid post-migration state transitions.
- [x] Expose deterministic metrics for each trade and the complete run.
- [x] Add scripted fixtures for the initial demo market.

### CLI

- [x] Add a typed JSON input format for the initial market intent.
- [x] Add `tymba validate` for intent/config validation.
- [x] Add `tymba simulate` for deterministic scripted trades.
- [x] Add `tymba inspect` or equivalent output for segment and migration metrics.
- [x] Ensure CLI output uses plain economic language first and raw protocol values only in an advanced section.
- [x] Make CLI output machine-readable in addition to human-readable where practical.

### Phase gate

- [x] The CLI can load the example intent from `spec.md`.
- [x] A deterministic run produces stable output across repeated executions.
- [x] The simulator output includes capital, distribution, migration price, fees, surplus, and allocation metrics.
- [x] The CLI is useful without a web UI.

## Phase 4 — Implement the inverse curve solver

Goal: convert a validated economic intent into one or more legal DBC candidates.

### Constraint pipeline

- [x] Normalize prices, FDV, supply, quote targets, percentages, fees, and migration settings.
- [x] Derive exact values when start or migration price can be calculated directly.
- [x] Validate incompatible or incomplete constraint combinations.
- [x] Return clear `satisfied`, `partial`, or `unsatisfied` results.
- [x] Explain conflicts in economic language and suggest measurable alternatives.

### Candidate generation and optimization

- [x] Support a fixed initial segment count, starting with three segments.
- [x] Generate increasing candidate price breakpoints.
- [x] Solve segment liquidity analytically where possible.
- [x] Optimize remaining variables with a deterministic strategy.
- [x] Enforce local candidate guardrails: positive u128 liquidity, segment limits, curve shape/price encoding, positive u64 supply and migration threshold, curve capacity, and distributed-base not exceeding supply. Full Meteora config and SDK supply validation remain separate gates below.
- [x] Define and implement the six-term objective with explicit normalized weights and metrics, deterministic error normalization, and required evidence for positively weighted impact/attack terms (`src/domain/solver-objective.ts`; `spec.md` §7.5).
- [x] Rank up to three SDK-validated candidates by ascending objective score with a deterministic candidate-id tie-break; exclude unverified candidates (`src/domain/solver-candidate-ranking.ts`).
- [x] Explain each segment's chosen liquidity with its price band, quote/base amounts and shares, plus the active quote/distribution objective weights; keep explanations evidence-based and do not claim global optimality (`src/domain/solver-explanations.ts`).

### Solver tests

- [x] Add satisfiable fixtures for start/migration prices and independent quote/distribution targets (`src/domain/inverse-curve-solver.test.ts`; 6 focused tests and TypeScript check pass).
- [x] Add unsatisfiable fixtures with economic conflict explanations and measurable alternatives (`src/domain/inverse-curve-solver.test.ts`; insufficient quote for both two- and three-segment curves, plus missing-measurement rejection).
- [x] Add boundary tests for minimum/maximum segment counts (1/16) and liquidity (1/u128 max), with over-limit rejection (`src/domain/solver-candidate-validation.test.ts`; full `pnpm check` passes, 169 tests).
- [x] Verify each locally valid solver candidate with the deterministic simulator, compare quote/base/price outputs, and source candidate economics from simulator results (`src/domain/solver-deterministic-verification.ts`; `pnpm check` passes with 169 tests and build succeeds).
- [x] Verify generated candidate curves with the pinned Meteora SDK `validateCurve` and record version/count evidence; reject SDK failures while retaining `unverified` status until full config validation (`src/domain/solver-sdk-validation.ts`; `pnpm check` passes with 171 tests and build succeeds).
- [x] Record JSON-safe normalized inputs, engine/algorithm/SDK versions, explicit configuration/objective weights, no-randomness seed policy, evidence, issues, and output metrics (`src/domain/solver-run-record.ts`; repeated runs produce identical JSON; full `pnpm check` passes with 172 tests and build succeeds).

### Phase gate

- [x] `tymba compile example.json` returns a legal, verified candidate or a clear failure state. The current demo request returns a structured `blocked` state with reason `full_configuration_validation_pending`, no deployable candidate, and non-zero exit (`src/cli/compile.ts`, `examples/demo-compile-request.json`).
- [x] Solver output metrics are reproduced by the deterministic simulator; each candidate's quote, base distribution, BPS, and terminal price are compared before output and metrics come from the simulation (`src/domain/solver-deterministic-verification.ts`; compile CLI tests).
- [x] No unvalidated deployable configuration is emitted: curve drafts remain `unverified`, and CLI `deployableCandidates` is always empty until full SDK config/supply validation exists (`src/cli/compile.test.ts`).

## Phase 5 — Add stochastic simulation and adversarial attacks

Goal: model how agents and attack strategies interact with the compiled market.

### Simulation foundation

- [x] Define versioned SplitMix64 seeded random-number generation, reject out-of-range seeds, and persist the exact seed plus algorithm id in stochastic/attack run metadata; deterministic runs remain seedless because they consume no randomness (`src/domain/seeded-random.ts`; 5 focused tests, typecheck, and formatting pass).
- [x] Implement seeded simulation ticks, shared pre-trade observations, decisions, explicitly configured or seeded-random sequential execution, clock advancement, and event traces for actions, fills, rejections, and agent failures (`src/domain/stochastic-simulation.ts`; spec §9.2 updated; 4 focused runner tests plus typecheck and formatting pass).
- [x] Implement all seven rule-based MVP agents with explicit behavior parameters, wallet/cost-basis tracking, balance-safe trades, and seeded stochastic choices (`src/domain/simulation-agents.ts`, `src/domain/stochastic-simulation.ts`; spec §9.1 documents their assumptions; 13 focused tests, typecheck, lint, and build pass).
- [x] Define exact per-archetype population counts and behavior templates, deterministic generated agent IDs, and explicit seed/pool/tick/clock/execution parameters; cap synchronous MVP population at 10,000 (`src/domain/simulation-scenario.ts`; 4 focused tests, typecheck, and build pass).
- [x] Add seeded Monte Carlo execution and nearest-rank p05/median/p95, graduation frequency, retained iteration seed/status/failure records, and transparent uncertainty labels; partial/failed runs are excluded from distributions and no summary is fabricated when all iterations fail (`src/domain/monte-carlo.ts`; spec §§9.3/20.1; 4 focused tests; full `pnpm check` passes with 196 tests and build succeeds).
- [x] Track DBC-threshold graduation frequency, conditional time-to-migration, maximum drawdown/price impact, tracked-agent top-holder concentration, total trading-fee and creator-fee distributions (`src/domain/monte-carlo.ts`; spec §§9.3/20.1 clarify units and modeled scope; focused graduation fixture plus full `pnpm check` passes with 197 tests and build succeeds).

### Required attacks

- [x] Implement opening sniper attack with a demand-gated single exit, retained per-seed partial/failure outcomes, signed PnL, late-buyer disadvantage, post-exit drawdown, and fees (`src/domain/attacks/opening-sniper.ts`; full `pnpm check` passes with 200 tests and `pnpm build` succeeds).
- [x] Implement whale-entry attack sized from the explicit migration-quote share, with post-fill spot displacement, base acquired, average execution price, tracked-wallet concentration, retained seeded outcomes, and resource limits (`src/domain/attacks/whale-entry.ts`; full `pnpm check` passes with 203 tests and `pnpm build` succeeds).
- [x] Implement pump-and-dump attack with an explicit buy, demand/hold-gated single exit after momentum-agent fills, attacker PnL, late-buyer loss, peak drawdown, fees, and exact quote required to recover the prior peak (`src/domain/attacks/pump-and-dump.ts`; full `pnpm check` passes with 206 tests and `pnpm build` succeeds).
- [x] Implement sell-cascade attack with explicit profit-taker/panic-seller agents, a same-seed background-only baseline, tracked quote outflow, drawdown, pre-cascade recovery quote, and signed migration-time delta (`src/domain/attacks/sell-cascade.ts`; full `pnpm check` passes with 208 tests and `pnpm build` succeeds).
- [x] Implement deterministic fee-schedule timing across eligible linear/exponential fee boundaries; compare identical round-trips, record every candidate, and report best clock, fee savings, and quote-PnL improvement without random-seed metadata (`src/domain/attacks/fee-schedule-timing.ts`; full `pnpm check` passes with 210 tests and `pnpm build` succeeds).
- [x] Add and verify scenario-specific outputs for attacker PnL, buyer disadvantage/loss, price displacement, drawdown, fees, recovery demand, concentration, migration delay, and fee-schedule savings; each metric uses asset-tagged amounts, Decimal prices, or bigint basis points as applicable (`src/domain/attack-result.ts`, `src/domain/attacks/*`; full `pnpm check` passes with 210 tests and `pnpm build` succeeds).
- [x] Add `tymba attack example.json --scenario sniper` with strict decimal-string request parsing, explicit optional pre-scenario warm-up, JSON/human reports, and clear modeled/non-deployable labeling (`src/cli/attack.ts`, `src/cli/index.ts`, `examples/demo-attack-request.json`; all five built-CLI scenario commands complete).
- [x] Add deterministic attack fixtures with pinned seeds and output snapshots for all four stochastic attacks plus a seedless deterministic fee-schedule fixture (`src/domain/attacks/*.test.ts`, `src/domain/attacks/__snapshots__`; replay and fixture tests pass in the full 214-test suite).

### Phase gate

- [x] Run all five attack scenarios to completion against the same deterministic solver-generated curve-draft ID, `curve-quote-1-1-149999999998` (`src/cli/attack.test.ts` and built-CLI runs; shared explicit request and pre-scenario state; full DBC/supply validation remains pending and the candidate stays `unverified`).
- [x] Verify a seeded attack replay produces an identical result; each stochastic attack test also pins iteration seeds and snapshots the expected metrics.
- [x] Verify reports retain the explicit market/solver/simulation/attack and warm-up assumptions, label evidence as modeled, and separate observed run results; no report implies deployability. Final `pnpm check` passes (214 tests), and `pnpm build` succeeds.

## Phase 6 — Build the economic audit and hardening loop

Goal: turn simulation output into actionable findings and measurable improvements.

### Audit engine

- [x] Define the editable, versioned `demo-v1` severity policy with centralized per-metric heuristic thresholds, retain raw metrics and policy versions, and document that thresholds are provisional rather than protocol guarantees (`src/domain/audit-policy.ts`, `spec.md` §11.2/§20.3; 4 focused tests pass).
- [x] Implement price-stability analysis, including stage-specific deterministic price impact, maximum drawdown, stochastic p95 metrics, exact run evidence, policy-derived severity, and trade-off-bearing recommendations (`src/domain/price-stability-audit.ts`; 4 focused tests; full `pnpm check` passes with 222 tests; `pnpm build` succeeds).
- [x] Implement concentration analysis from tracked-agent top-holder/top-ten p95 metrics and adversarial whale-entry concentration; retain evidence scope and avoid claims about unmodeled wallets (`src/domain/concentration-audit.ts`; 3 focused tests; full `pnpm check` passes with 225 tests; `pnpm build` succeeds).
- [x] Implement early-participant advantage analysis with exact first-10%-quote re-quoting, nearest-rank median buyer price, paired seeded-run distributions, raw price/volume evidence, and policy-derived severity (`src/domain/monte-carlo.ts`, `src/domain/early-advantage-audit.ts`; focused tests plus full `pnpm check` pass with 227 tests; `pnpm build` succeeds).
- [x] Implement sniper-exposure analysis using opening-attack p95 PnL and an explicit per-run capital-at-risk basis; retain signed PnL, capital evidence, and trade-offs (`src/domain/sniper-exposure-audit.ts`; 3 focused tests; full `pnpm check` passes with 230 tests; `pnpm build` succeeds).
- [x] Implement exit-liquidity sensitivity analysis for sniper, pump-and-dump, and sell-cascade exits using p95 drawdown plus explicitly separate recovery/outflow evidence (`src/domain/exit-liquidity-audit.ts`; 2 focused tests; full `pnpm check` passes with 232 tests; `pnpm build` succeeds).
- [x] Implement migration-fragility analysis with paired-seed baseline and caller-described late-stage quote-capital stress, graduation-failure frequency, and non-causal modeled-evidence labeling (`src/domain/migration-fragility-audit.ts`; 3 focused tests; full `pnpm check` passes with 235 tests; `pnpm build` succeeds).
- [x] Implement fee-shock analysis from exact simulator scheduled base-fee numerators at adjacent linear/exponential timing candidates; retain fractional-bps, numerator, and separate asset-fee evidence (`src/domain/fee-shock-audit.ts`; 3 focused tests; full `pnpm check` passes with 238 tests; `pnpm build` succeeds).
- [x] Implement surplus-behavior analysis with deterministic evidence, paired p95 recipient allocations for graduated stochastic iterations, explicit fill-clamp/parity caveats, versioned severity, and trade-off recommendations (`src/domain/surplus-behavior-audit.ts`, `src/domain/monte-carlo.ts`; 3 focused tests; full `pnpm check` passes with 241 tests across 51 files; `pnpm build` succeeds).
- [x] Implement post-migration liquidity analysis with six-bucket conservation, aggregate unlocked/vesting/locked shares, exact run evidence, versioned severity, and allocation trade-offs (`src/domain/post-migration-liquidity-audit.ts`; 4 focused tests; full `pnpm check` passes with 245 tests across 52 files; `pnpm build` succeeds).
- [x] Assign `LOW`, `MODERATE`, or `HIGH` severity with exact supporting metrics through the centralized, versioned policy for all implemented audit categories.
- [x] Generate suggested mitigations tied to controllable curve, fee, migration, or allocation inputs, with an explicit trade-off per recommendation.

### Harden and compare

- [x] Convert selected raw early-impact and opening-sniper findings into their semantically matching solver penalties; preserve original weight ratios, require explicit added risk weights, and report unsupported findings rather than substituting severity (`src/domain/audit-solver-objective.ts`; 3 focused tests plus solver intent-limit coverage; full `pnpm check` passes with 249 tests across 53 files; `pnpm build` succeeds).
- [x] Generate a hardened candidate from the unchanged normalized intent and simulator configuration; retain the original candidate/findings, filter and explain candidates that miss original targets, and keep the hardened curve unverified (`src/domain/harden-market-candidate.ts`; 2 focused tests; full `pnpm check` passes with 251 tests across 54 files; `pnpm build` succeeds).
- [x] Re-run deterministic, stochastic, and attack simulations with paired baseline/hardened inputs, identical seeded stochastic and attack configurations, and explicit failure retention (`src/domain/harden-market-resimulation.ts`; `pnpm check` passes with 251 tests across 54 files; `pnpm build` succeeds).
- [x] Produce a before/after diff for raw replay risk, quote/distribution target error, migration, segment complexity, and asset-separated fees; preserve unavailable/partial states (`src/domain/harden-market-comparison.ts`; full `pnpm check` passes with 251 tests across 54 files; `pnpm build` succeeds).
- [x] Preserve the original candidate, selected finding evidence, and complete paired replay outputs/seeds inside the comparison artifact (`src/domain/harden-market-comparison.ts`; regression assertions in `src/domain/harden-market-candidate.test.ts`; full `pnpm check` passes with 251 tests across 54 files; `pnpm build` succeeds).
- [x] Reject hardened candidates that change original quote/distribution targets, start/migration boundaries, supply, simulator settings, or the numeric early-impact limit at the retained probe; preserve explicit rejection reasons (`src/domain/harden-market-candidate.ts`; zero-limit regression case; full `pnpm check` passes with 251 tests across 54 files; `pnpm build` succeeds).

### Phase gate

- [x] A seeded demo shows a measurable reduction in at least one selected risk (`src/domain/harden-market-candidate.test.ts`; attack seed `9921`; raw opening-sniper p95 return falls 251 → 199 bps, with p95 quote PnL falling 12,562,158 → 9,961,208 atomic units; paired seeds and original constraints are asserted).
- [x] The audit does not use unsupported single-number “safety scores” (`AuditFinding`/`AuditCategoryResult` expose raw observations and per-finding severity only; `price-stability-audit.test.ts` asserts no aggregate score fields).
- [x] Every recommendation identifies the economic trade-off it introduces (`src/domain/audit-finding.ts` rejects recommendations without an explicit trade-off; all 35 focused audit/policy/objective tests pass).
- [x] Phase 6 verification passes: `pnpm check` (252 tests across 55 files) and `pnpm build`.

## Phase 7 — Build the MVP web experience

Goal: make the proven domain workflow understandable and demoable.

### Product flow

- [x] Add Describe view with structured intent fields.
- [x] Add optional natural-language intent input.
- [x] Validate and display the structured interpretation before solving.
- [x] Add Compile view with satisfiability status, candidate ranking, and conflicts.
- [x] Add curve visualization with segment selection and economic explanations.
- [x] Add deterministic simulation controls and metrics.
- [x] Add Attack My Market controls for all MVP attacks.
- [x] Add audit findings with severity and supporting metrics.
- [x] Add Harden Market action and before/after comparison.
- [x] Add advanced view for raw DBC parameters and units.
- [x] Add loading, error, empty, unsupported, and partial-result states.
- [x] Ensure the UI never presents modeled outcomes as guarantees.

First-six implementation notes: `pnpm dev` runs the local studio. Natural-language input is a retained, explicitly uninterpreted design note; automatic AI parsing remains later work. Compile ranks non-deployable curve drafts only. The reviewed configuration is explicit and editable; core-target status does not claim unmeasured preferences were enforced. Deterministic scripts retain clocks, partial fills, asset-specific fees, and modeled/unverified status. The design-to-audit workflow and report artifact now pass their Phase 7 gates.

Next-five implementation notes: all attack controls use selected drafts and editable fixture assumptions; fixed-fee timing is explicitly unsupported. Audits recompute source inputs and retain raw metrics plus the complete versioned heuristic policy. Missing stochastic-cohort, paired capital-stress, and destination LP evidence stays unavailable. Hardening preserves original targets/settings and replays explicit scripts, stochastic seeds/populations, and retained attacks; unsupported mappings, target rejection, and partial/failed outcomes remain visible. Paired hardening currently requires attacks without warm-ups. Advanced views preserve exact atomic, Q64.64, and liquidity values. Report artifacts and Phase 7 gates are complete; devnet deployment remains open.

Final product-flow implementation notes: shared, visible evidence notices qualify review, core-target satisfiability, the mathematical curve graph, deterministic script completion, attack sample percentiles, heuristic severity, and per-metric hardening comparisons. Compile scope warnings stay expanded in the main result. LOW severity is not a safety certificate; unavailable evidence is not zero risk; completed hardening may be unchanged or worse. Partial improvement assessments are explicitly limited to available evidence. No signing or deployment is available. All product-flow, report-artifact, and Phase 7 gate items are checked; Phase 8 devnet deployment and verification remain open.

Verification before Phase 8: `pnpm check` passed 293 tests across 63 files; `pnpm build` passed; `pnpm test:web` passed all 19 browser checks. Coverage includes reproducible demo compilation, seeded attack and audit report output, report download/schema, mixed completed/partial attack samples and paired hardening, unsupported fixed fees, explicit scheduled-fee sweeps without seeds, policy versioning, exact units, mobile layout, network retry, stale-response invalidation, visible claims limits, LOW/unavailable distinctions, and complete/partial/unavailable improvement assessments. Desktop and mobile evidence-notice screenshots were inspected. Solver evidence is retained from the original compile rather than solving twice; SDK-heavy tests use bounded worker concurrency.

### Report artifact

- [x] Define a versioned report schema (`spec.md` §20.7; `src/web/report.ts`, schema version 1).
- [x] Add export or shareable report output for a compiled market and audit (downloadable JSON from the completed/partial audit view; targeted browser download check passes).
- [x] Include input intent, solver version, seeds, candidate parameters, metrics, findings, and verification status (report builder and focused schema tests retain these fields and serialize repeatably).
- [x] Do not include private keys, secrets, or wallet signing material (sensitive field names are excluded recursively; regression test confirms they do not enter the export).

### Phase gate

- [x] A new user can understand the product flow without reading protocol jargon (visible six-step guide and plain-language action labels in `src/web/App.tsx`, `src/web/Compile.tsx`, and `src/web/Simulate.tsx`; mobile-width guide coverage in `tests/e2e/workflow.spec.ts`).
- [x] The complete design-to-audit story works against the deterministic backend/domain APIs (`pnpm test:web`: 19/19 browser checks across review, compile, replay, attacks, audit, hardening, and report export).
- [x] The seeded demo can be repeated reliably for judging or review (`src/web/report.test.ts` reruns demo compilation and the seeded opening-sniper audit and asserts identical serialized reports; deterministic browser replay and API seed tests pass).

## Phase 8 — Meteora devnet deployment and verification

Goal: deploy only an approved, validated configuration and verify the on-chain result.

### Safety and wallet flow

- [x] Add network and wallet validation (fixed Devnet RPC identity plus an explicitly connected Wallet Standard account; validates its Devnet chain, public-key consistency, legacy transaction capability, and account-change notifications. This is read-only setup evidence; automated RPC behavior is mocked and does not establish live Devnet availability.)
  - First-increment verification: `pnpm check` passes 299 tests across 64 files; `pnpm build` passes; `pnpm test:web` passes 20 browser checks, including the mocked network/wallet connection flow and account-change invalidation. No live RPC request or transaction was sent during automated verification.
- [x] Add configuration validation immediately before transaction construction (`src/meteora/deployment-transaction-gate.ts` runs validation before the local builder, passes only the normalized accepted value, and blocks invalid or thrown validation. It introduces no signer or submission path; the pinned SDK configuration validator and actual builders remain subsequent work.)
  - Verification: `pnpm check` passes 303 tests across 65 files; `pnpm build` passes. Gate tests prove invalid and throwing validators cannot call the builder. No actual SDK transaction builder is wired yet.
- [x] Validate the fully assembled SDK candidate with `validateConfigParameters` and verify day-one minimum locked liquidity from complete vesting schedules (`src/meteora/complete-config-validation.ts`; four tests build candidates with pinned SDK 1.5.13, including a complete delayed-vesting schedule that yields 999 bps and is rejected. The adapter sanitizes SDK failures and is not yet wired to an application config or transaction builder.)
  - Verification: `pnpm check` passes format, lint, both TypeScript projects, and 307 tests across 66 files; `pnpm build` passes. No live RPC or transaction was used.
- [ ] Add balance and fee-budget checks.
- [ ] Add transaction preview and simulation.
- [ ] Require explicit final user approval before signing/broadcasting.
- [ ] Keep secrets and signing material out of logs, fixtures, reports, and errors.

### Deployment

- [ ] Build the Meteora configuration through the pinned SDK adapter.
- [ ] Create config/pool on devnet.
- [ ] Capture signatures, addresses, transaction links, and deployment metadata.
- [ ] Fetch deployed on-chain state.
- [ ] Compare on-chain values with compiled values using documented tolerances.
- [ ] Verify migration reachability and allocation/accounting behavior where devnet supports it.
- [ ] Persist a deployment record and verification status.
- [ ] Document all devnet limitations and any behavior not yet proven on-chain.

### Phase gate

- [ ] A seeded demo candidate can be deployed to devnet through an explicit approval flow.
- [ ] The system proves what was deployed rather than trusting only local output.
- [ ] Mainnet deployment remains disabled until devnet parity is reliable and explicitly approved.

## Phase 9 — Demo hardening and MVP release

Goal: package one compelling, truthful, reproducible end-to-end demonstration.

### Demo profile

- [ ] Prepare the deterministic profile from the spec: 1B supply, ~$200k start FDV, ~$2M migration FDV, ~$150k quote target, ~25% distribution, balanced profile, high sniper resistance.
- [ ] Store the demo input and all seeds in version-controlled fixtures.
- [ ] Confirm the candidate is legal and all metrics are reproducible.
- [ ] Confirm at least one attack exposes a meaningful risk.
- [ ] Confirm hardening produces a measurable before/after improvement.
- [ ] Confirm the demo report clearly labels modeled versus on-chain values.

### Release quality

- [ ] Run formatting, linting, type checking, unit tests, property tests, parity tests, and relevant integration tests.
- [ ] Run the complete seeded demo from a clean environment.
- [ ] Test failure paths: invalid intent, conflicting constraints, solver failure, simulation failure, SDK mismatch, wallet rejection, and transaction failure.
- [ ] Review user-facing copy against the economic-claims restrictions in `spec.md`.
- [ ] Review dependency versions and environment configuration.
- [ ] Update `README.md` with setup, commands, architecture, limitations, and verification status.
- [ ] Record known limitations and deferred work.

### MVP release gate

- [ ] Structured intent works.
- [ ] Optional natural-language intent is validated into structured constraints.
- [ ] Legal DBC candidate generation works.
- [ ] Deterministic simulator is verified.
- [ ] Curve visualization and explanations work.
- [ ] Five or more adversarial scenarios work.
- [ ] Economic audit works.
- [ ] Before/after hardening comparison works.
- [ ] Shareable/exportable report works.
- [ ] Devnet deployment and post-deployment verification work.
- [ ] A reviewer can understand the value proposition within 60–90 seconds.

## Explicitly deferred after MVP

- [ ] Mainnet deployment.
- [ ] Public config auditing and historical pool imports.
- [ ] Transfer-hook experiments as a separate advanced capability.
- [ ] Saved workspaces, teams, and multi-user review.
- [ ] Public API or MCP server.
- [ ] Marketplace of reusable launch strategies.
- [ ] Distributed simulation infrastructure before profiling proves it necessary.

## Current next action

- [x] Define and test the canonical `MarketIntent` validator and normalization; revise `spec.md` to remove the competing schemas and use the canonical demo fixture.
- [x] Define and test the protocol-compatible curve domain types and shape validator; keep SDK-specific range checks at the adapter boundary.
- [x] Define fee, migration, allocation, solver result, and warning types; keep the three-part intent allocation separate from the six protocol liquidity buckets until their mapping is verified.
- [x] Define deterministic pool state and trade-result types with separate atomic ledgers, both clock units, SDK volatility state, and asset-tagged amounts.
- [x] Define stochastic simulation, attack, audit finding, and deployment-record types; document their canonical contracts in `spec.md` §20.
- [x] Define explicit status values for validation, solver outcomes, and verification evidence (`src/domain/status.ts`).
- [ ] Verify the quote-mint end-to-end devnet gate before adoption; this requires an explicitly approved deployment/integration run.
