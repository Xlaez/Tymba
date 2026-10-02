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
- [ ] Initialize Git and create the initial repository baseline.
- [x] Add TypeScript configuration with strict type checking.
- [x] Add formatter and linter configuration.
- [x] Add a test runner and coverage command.
- [x] Add a root `README.md` with setup and verification commands.
- [x] Add `.gitignore` and environment-variable documentation.
- [x] Add the first CI/check command that runs formatting, linting, type checking, and tests.

### Product decisions to lock before coding

- [ ] Confirm the quote asset, token decimals, and unit conventions for the first demo profile.
- [x] Confirm whether the first CLI and domain packages will be a small single package or a monorepo.
- [x] Define the supported MVP intent fields and which fields are deferred, using `PRD.md` as the MVP boundary.
- [x] Define the first supported Meteora network: devnet only for MVP deployment.
- [ ] Define numerical tolerances for local-to-SDK parity checks.
- [x] Create a decision log for all unresolved Meteora questions.

### Phase gate

- [ ] A clean checkout can install dependencies and run the empty test suite.
- [x] The repository has one documented command for format, lint, type check, and test.
- [ ] No protocol behavior is implemented from an unverified assumption.

## Phase 1 — Verify Meteora behavior and establish domain contracts

Goal: create a verified protocol boundary before writing the solver.

### SDK and protocol research

- [ ] Select and pin the Meteora SDK version.
- [ ] Identify the deployed DBC program ID and supported network configuration.
- [ ] Verify curve-point representation, price scale, liquidity representation, and integer precision.
- [ ] Verify the maximum supported number of curve segments.
- [ ] Verify fixed versus dynamic supply behavior and leftover handling.
- [ ] Verify fee schedules, dynamic-fee state, and timestamp/slot semantics.
- [ ] Verify migration threshold, overshoot, surplus, and recipient behavior.
- [ ] Verify post-migration liquidity allocation, locking, vesting, and partner/creator economics.
- [ ] Verify immutable versus mutable configuration fields.
- [ ] Verify SDK helpers available for curve construction, quoting, validation, and deployment.
- [ ] Verify Token-2022 and transfer-hook behavior, but keep transfer hooks outside MVP core.
- [ ] Capture sources, SDK references, example values, and known limitations in a protocol notes document.

### Domain types

- [ ] Define `CurrencyAmount` and unit/decimal conversion rules.
- [ ] Define `MarketIntent` and validation rules.
- [ ] Define `CurveSegment` and `DbcCurve` using protocol-compatible representations.
- [ ] Define fee, migration, allocation, solver result, and warning types.
- [ ] Define deterministic pool state and trade-result types.
- [ ] Define simulation, attack, audit finding, and deployment-record types.
- [ ] Define explicit status values: satisfied, partial, unsatisfied, invalid, and verified/unverified where needed.

### Phase gate

- [ ] Protocol notes answer the open technical questions that affect MVP math or deployment.
- [ ] Domain types do not depend on UI, database, LLM, or wallet code.
- [ ] Invalid units, signs, ranges, segment ordering, allocations, and integer bounds have validation rules.

## Phase 2 — Implement and verify DBC math

Goal: build the smallest trustworthy mathematical core.

### Core calculations

- [ ] Implement the canonical price representation and conversion helpers.
- [ ] Implement quote required to traverse one segment.
- [ ] Implement base tokens distributed through one segment.
- [ ] Implement inverse/reverse calculations needed for verification.
- [ ] Implement multi-segment quote accumulation.
- [ ] Implement multi-segment base distribution.
- [ ] Implement buy quoting across segment boundaries.
- [ ] Implement sell quoting across segment boundaries.
- [ ] Implement explicit fee application and rounding behavior.
- [ ] Implement migration progress, threshold, overshoot, and surplus calculations.
- [ ] Implement post-migration allocation accounting needed by the MVP.

### Tests and parity

- [ ] Add known-value unit tests for every core formula.
- [ ] Add tests for exact segment-boundary trades.
- [ ] Add tests for trades spanning multiple segments.
- [ ] Add tests for buys and sells with fees.
- [ ] Add property tests for increasing liquidity reducing price movement for fixed input.
- [ ] Add property tests for monotonic price progression and valid segment ordering.
- [ ] Add approximate buy-then-sell reversibility tests with documented fee/rounding tolerance.
- [ ] Add tests that the multi-segment total equals the sum of segment calculations.
- [ ] Generate valid configurations and compare local quotes against the Meteora SDK.
- [ ] Document every intentional local-to-SDK difference and its tolerance.

### Phase gate

- [ ] The math package passes unit, property, and SDK parity tests.
- [ ] Every on-chain quantity has an explicit precision and rounding policy.
- [ ] No solver or UI work proceeds while core parity failures remain unexplained.

## Phase 3 — Build the deterministic simulator and CLI

Goal: expose the verified math through a complete in-memory pool model and the first user-facing milestone.

### Simulator

- [ ] Define complete in-memory pool state.
- [ ] Implement `quoteBuy`, `quoteSell`, `executeBuy`, and `executeSell`.
- [ ] Track reserves, distributed base, fees, spot price, and migration progress.
- [ ] Support trades that cross any valid number of configured segments.
- [ ] Model migration and prevent invalid post-migration state transitions.
- [ ] Expose deterministic metrics for each trade and the complete run.
- [ ] Add scripted fixtures for the initial demo market.

### CLI

- [ ] Add a typed JSON input format for the initial market intent.
- [ ] Add `tymba validate` for intent/config validation.
- [ ] Add `tymba simulate` for deterministic scripted trades.
- [ ] Add `tymba inspect` or equivalent output for segment and migration metrics.
- [ ] Ensure CLI output uses plain economic language first and raw protocol values only in an advanced section.
- [ ] Make CLI output machine-readable in addition to human-readable where practical.

### Phase gate

- [ ] The CLI can load the example intent from `spec.md`.
- [ ] A deterministic run produces stable output across repeated executions.
- [ ] The simulator output includes capital, distribution, migration price, fees, surplus, and allocation metrics.
- [ ] The CLI is useful without a web UI.

## Phase 4 — Implement the inverse curve solver

Goal: convert a validated economic intent into one or more legal DBC candidates.

### Constraint pipeline

- [ ] Normalize prices, FDV, supply, quote targets, percentages, fees, and migration settings.
- [ ] Derive exact values when start or migration price can be calculated directly.
- [ ] Validate incompatible or incomplete constraint combinations.
- [ ] Return clear `satisfied`, `partial`, or `unsatisfied` results.
- [ ] Explain conflicts in economic language and suggest measurable alternatives.

### Candidate generation and optimization

- [ ] Support a fixed initial segment count, starting with three segments.
- [ ] Generate increasing candidate price breakpoints.
- [ ] Solve segment liquidity analytically where possible.
- [ ] Optimize remaining variables with a deterministic strategy.
- [ ] Enforce positive liquidity, segment-count limits, supply rules, and all protocol constraints.
- [ ] Define and implement the objective function for quote, distribution, migration price, price impact, attack exposure, and complexity.
- [ ] Rank and return the best one to three valid candidates.
- [ ] Include explanations for why each candidate's liquidity distribution was chosen.

### Solver tests

- [ ] Add satisfiable fixtures for start price, migration price, quote target, and distribution target.
- [ ] Add unsatisfiable fixtures with clear conflict explanations.
- [ ] Add boundary tests for minimum/maximum segments and liquidity.
- [ ] Verify every solver result by running it through the deterministic simulator.
- [ ] Verify generated candidates against the Meteora SDK validator or builder.
- [ ] Record solver inputs, version, seed/configuration, objective weights, and output metrics.

### Phase gate

- [ ] `tymba compile example.json` returns a legal, verified candidate or a clear failure state.
- [ ] Solver output metrics are reproduced by the deterministic simulator.
- [ ] The solver never emits a configuration that bypasses protocol validation.

## Phase 5 — Add stochastic simulation and adversarial attacks

Goal: model how agents and attack strategies interact with the compiled market.

### Simulation foundation

- [ ] Define seeded random-number generation and persist the seed with every run.
- [ ] Implement simulation ticks, observations, actions, execution order, and event recording.
- [ ] Implement MVP agent archetypes: retail buyer, whale, sniper, momentum trader, profit taker, panic seller, and random trader.
- [ ] Define configurable agent distributions and scenario parameters.
- [ ] Add Monte Carlo aggregation with median, percentile, frequency, and confidence/uncertainty labeling.
- [ ] Track graduation, drawdown, concentration, fees, time-to-migration, and price-impact metrics.

### Required attacks

- [ ] Implement opening sniper attack.
- [ ] Implement whale-entry attack.
- [ ] Implement pump-and-dump attack.
- [ ] Implement sell-cascade attack.
- [ ] Implement fee-schedule timing attack.
- [ ] Add attack-specific metrics: attacker PnL, victim disadvantage, price displacement, drawdown, fees, and migration effects.
- [ ] Add `tymba attack example.json --scenario sniper`.
- [ ] Add deterministic seeded fixtures for each attack.

### Phase gate

- [ ] At least five attack scenarios run against the same compiled candidate.
- [ ] Repeating a seeded run produces the same results.
- [ ] Reports clearly distinguish assumptions, modeled behavior, and observed results.

## Phase 6 — Build the economic audit and hardening loop

Goal: turn simulation output into actionable findings and measurable improvements.

### Audit engine

- [ ] Implement price-stability analysis.
- [ ] Implement concentration analysis.
- [ ] Implement early-participant advantage analysis.
- [ ] Implement sniper-exposure analysis.
- [ ] Implement exit-liquidity sensitivity analysis.
- [ ] Implement migration-fragility analysis.
- [ ] Implement fee-shock analysis.
- [ ] Implement surplus-behavior analysis.
- [ ] Implement post-migration liquidity analysis.
- [ ] Assign `LOW`, `MODERATE`, or `HIGH` severity with exact supporting metrics.
- [ ] Generate suggested mitigations tied to controllable curve, fee, or allocation inputs.

### Harden and compare

- [ ] Convert selected findings into solver penalties or constraints.
- [ ] Generate a hardened candidate from the original intent.
- [ ] Re-run deterministic, stochastic, and attack simulations.
- [ ] Produce a before/after diff for risk, quote error, distribution, migration, complexity, and fees.
- [ ] Preserve the original candidate and audit evidence.
- [ ] Ensure improvements do not silently violate the original economic intent.

### Phase gate

- [ ] A seeded demo shows a measurable reduction in at least one selected risk.
- [ ] The audit does not use unsupported single-number “safety scores.”
- [ ] Every recommendation identifies the economic trade-off it introduces.

## Phase 7 — Build the MVP web experience

Goal: make the proven domain workflow understandable and demoable.

### Product flow

- [ ] Add Describe view with structured intent fields.
- [ ] Add optional natural-language intent input.
- [ ] Validate and display the structured interpretation before solving.
- [ ] Add Compile view with satisfiability status, candidate ranking, and conflicts.
- [ ] Add curve visualization with segment selection and economic explanations.
- [ ] Add deterministic simulation controls and metrics.
- [ ] Add Attack My Market controls for all MVP attacks.
- [ ] Add audit findings with severity and supporting metrics.
- [ ] Add Harden Market action and before/after comparison.
- [ ] Add advanced view for raw DBC parameters and units.
- [ ] Add loading, error, empty, unsupported, and partial-result states.
- [ ] Ensure the UI never presents modeled outcomes as guarantees.

### Report artifact

- [ ] Define a versioned report schema.
- [ ] Add export or shareable report output for a compiled market and audit.
- [ ] Include input intent, solver version, seeds, candidate parameters, metrics, findings, and verification status.
- [ ] Do not include private keys, secrets, or wallet signing material.

### Phase gate

- [ ] A new user can understand the product flow without reading protocol jargon.
- [ ] The complete design-to-audit story works against the deterministic backend/domain APIs.
- [ ] The seeded demo can be repeated reliably for judging or review.

## Phase 8 — Meteora devnet deployment and verification

Goal: deploy only an approved, validated configuration and verify the on-chain result.

### Safety and wallet flow

- [ ] Add network and wallet validation.
- [ ] Add configuration validation immediately before transaction construction.
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

- [ ] Decide the initial TypeScript/package-manager setup and begin Phase 0.
