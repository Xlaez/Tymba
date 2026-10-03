# Tymba — Product Requirements Document

## 1. Product summary

Tymba is an inverse compiler, simulator, economic audit engine, and deployment workflow for Meteora Dynamic Bonding Curve (DBC) markets.

The product translates a creator's desired market behavior into legal Meteora DBC configuration candidates, verifies those candidates with deterministic mathematics, tests them under stochastic and adversarial trading scenarios, explains the economic risks, and eventually deploys an approved configuration to Meteora.

Product promise:

> Describe the market you want. Compile it. Simulate it. Attack it. Harden it. Deploy it.

Tymba is market-design infrastructure, not a generic token launchpad, trading terminal, AI trading bot, or guarantee of fundraising or manipulation resistance.

## 2. Source of truth and authority

- `spec.md` is the canonical product and technical specification.
- This PRD is a planning summary derived from `spec.md`; it must not silently override it.
- The currently deployed Meteora program and SDK are authoritative for protocol behavior, integer representations, limits, rounding, fees, migration, and deployment semantics.
- Tymba's initial demo uses USD-stable quote semantics (USDC on mainnet and a controlled six-decimal SPL test mint on devnet if the full migration flow is supported), with 9 base-token decimals and 6 quote-token decimals.
- The continuous economic solver and discrete DBC protocol math must remain separate. Only the quantized candidate, after deterministic simulation and SDK validation, supplies user-visible metrics.
- When implementation discovers a conflict with the spec, stop and document the discrepancy before choosing a behavior. Update the relevant documentation after the behavior is verified.

## 3. Users and core job

Primary user: a token creator or market designer who understands desired outcomes but does not want to manually reason about low-level DBC parameters.

The user should be able to express goals such as:

- starting and graduation FDV;
- quote capital required before migration;
- percentage of supply distributed before migration;
- price sensitivity and early-buyer advantage;
- opening sniper resistance;
- post-migration locked, vested, and unlocked allocations.

The system must translate these goals into explicit, measurable constraints rather than treating natural-language output as financial mathematics.

## 4. MVP workflow

The conceptual product flow is:

```text
Describe → Compile → Explain → Simulate → Attack → Audit → Harden → Deploy
```

### Describe

- Support a structured market-intent form.
- Support optional natural-language intent input.
- Convert natural language to a typed `MarketIntent` for validation.
- Return explicit `valid` or `invalid` validation status; invalid intents include actionable field-level issues and do not proceed to solving.
- Keep protocol jargon out of the primary UI; expose raw DBC parameters only in an advanced view.

### Compile

- Normalize constraints and derive exact values where possible.
- Solve for one or more legal DBC curves.
- Return `satisfied`, `partial`, or `unsatisfied` status.
- Explain conflicting constraints and provide valid alternatives when possible.
- Return the top one to three deterministic, ranked candidates rather than an opaque single answer.

### Explain

- Describe every segment in economic language: price range, quote absorbed, base distributed, and purpose.
- Explain how liquidity, fees, and migration settings affect observable behavior.
- Make clear which values are modeled, approximate, or protocol-verified.

### Simulate

- Implement deterministic buys and sells across multiple segments.
- Include fees, dynamic fees where supported, migration thresholds, surplus, and post-migration accounting.
- Add stochastic agent simulations for the MVP archetypes listed in `spec.md`.
- Store and display the random seed for reproducible demo and test runs.
- Report nearest-rank p05/median/p95 over completed iterations only, retain failed/partial iteration seeds and statuses, and label uncertainty without implying statistical confidence intervals.
- Implement fee-schedule timing as a deterministic sweep over fee-decay boundaries; record candidate clocks/results without inventing a random seed.

### Attack and audit

- Implement at least five adversarial scenarios: opening sniper, whale entry, pump and dump, sell cascade, and fee-schedule timing.
- Produce exact supporting metrics and severity labels (`LOW`, `MODERATE`, `HIGH`).
- Avoid fake composite safety scores and avoid guarantees.
- Allow the user to optimize against selected findings and show a before/after comparison.

### Deploy

- Target Meteora devnet first.
- Validate wallet, network, configuration, allocations, supply, fees, migration reachability, balance, and transaction simulation before broadcast.
- After deployment, fetch on-chain state and compare it with the compiled configuration.
- Record the deployment and verification result.

## 5. Functional requirements

### Solver

The solver must support, at minimum:

- token supply;
- start price or start FDV;
- migration price or migration FDV;
- quote target;
- target base-distribution percentage;
- maximum segment count;
- early price-impact target;
- launch profile (`deep`, `balanced`, or `momentum`);
- fee and migration intent.

Candidates must obey protocol-valid constraints, including increasing prices, positive liquidity, segment-count limits, valid supply/allocation rules, and exact integer/rounding behavior required by the Meteora SDK/program.

### Deterministic math and simulator

The implementation must cover:

- segment quote absorption;
- segment base-token distribution;
- multi-segment buys and sells;
- fees and fee schedules;
- spot-price and migration-progress calculation;
- migration and surplus accounting;
- post-migration allocation accounting.

The core math must use safe precision and explicit rounding policies. Avoid floating-point values for on-chain quantities where integer arithmetic or a documented fixed-point representation is required.

Use `bigint` for atomic amounts; exact parity is the default for protocol outputs. Any exception is helper-specific, documented, and no more than one atomic unit. The pinned public builder accepts up to 16 curve entries, one per segment; because the starting boundary is supplied separately, a 16-segment curve has 17 sqrt-price boundaries. Legacy stored configs can hold 20 entries, which remains a separate import/audit capacity.

### Reporting

Reports must distinguish:

- deterministic calculations;
- stochastic simulation results;
- adversarial scenario results;
- on-chain verified values.

Simulation output must be labeled as modeled evidence, not a prediction or guarantee.

The web studio exports a versioned JSON report for a compiled market and completed or partial audit. It retains intent, explicit solver/simulation settings, selected candidate parameters and metrics, engine/algorithm/SDK versions, random seeds, audit policy and findings, and the source evidence needed to replay the modeled results. The report schema is versioned in `spec.md` §20.7. Exports exclude credentials and wallet signing material.

## 6. Non-functional requirements

- Deterministic solver and simulator runs must be reproducible from inputs and seeds.
- Generated configurations must be explainable and auditable.
- Numerical behavior must be tested against official Meteora SDK behavior wherever possible.
- Protocol limits and unsupported capabilities must be surfaced explicitly.
- The system must never imply that vanilla DBC enforces per-wallet ownership caps, oracle-driven curve rewrites, or other capabilities it does not provide.
- Natural-language AI may interpret and explain; it must not be authoritative for swaps, fees, migration, optimization validity, or deployment correctness.
- The MVP should favor reliable, deterministic TypeScript implementation over premature distributed infrastructure.

## 7. MVP acceptance criteria

The MVP is complete when it can demonstrate all of the following with one reproducible seeded scenario:

1. Accept a structured intent and optionally parse natural language into the same schema.
2. Produce a legal Meteora DBC configuration candidate or a clear unsatisfied/partial result.
3. Show capital, distribution, migration-price, fee, and allocation metrics.
4. Verify deterministic segment and multi-segment swap calculations.
5. Visualize the curve and explain its segments.
6. Run five or more adversarial scenarios and generate an economic audit.
7. Harden a selected configuration and show before/after metrics.
8. Deploy to Meteora devnet, then verify on-chain state against the compiled values.
9. Export or share an audit/report artifact.
10. Make the complete value proposition understandable in a 60–90 second demo.

## 8. Delivery sequence

Build from the math upward:

1. Confirm the current Meteora SDK/program behavior and create a minimal CLI harness.
2. Implement and parity-test DBC math.
3. Implement the deterministic in-memory simulator.
4. Implement the constrained inverse solver for the simplest supported intent set.
5. Add adversarial strategies and reproducible stochastic simulation.
6. Add audit rules and improvement-loop diffs.
7. Build the web workflow around proven domain APIs.
8. Add devnet deployment and post-deployment verification.
9. Add AI interpretation after deterministic systems are reliable.

The first meaningful engineering milestone should be a CLI equivalent to:

```bash
pnpm tymba compile example.json
pnpm tymba attack example.json --scenario sniper
```

## 9. Initial architecture

Start as one TypeScript package. Keep `src/economics` and `src/dbc-math` as distinct domain modules, independent from UI and network side effects. Create a TypeScript monorepo only when those boundaries need an independent package lifecycle or tooling.

Suggested boundaries:

- `packages/domain`: intent, curve, fee, migration, and shared types;
- `packages/dbc-math`: exact pricing, segment, swap, fee, and migration calculations;
- `packages/optimizer`: constraints, candidate generation, objective function, and solver;
- `packages/simulator`: deterministic, stochastic, agent, and metrics modules;
- `packages/adversarial`: attack strategies;
- `packages/audit`: rules, severity, findings, and reports;
- `packages/meteora`: SDK adapter, config builder, deployment, and fetch/verification;
- `apps/api`: orchestration and persistence;
- `apps/web`: Describe/Compile/Simulate/Attack/Audit/Deploy workflow;
- `tests`: unit, property, SDK parity, integration, and devnet verification tests.

Do not create these directories merely to match the proposal. Add them as implementation needs arise.

## 10. Open questions requiring verification

Before production deployment, validate against the current SDK/program:

- curve-point representation and integer precision;
- maximum public-builder point count and legacy stored-config capacity, including their mapping to product segments;
- fixed versus dynamic supply constraints;
- dynamic-fee evolution and scheduler timing;
- exact migration overshoot, configurable migration-fee, surplus split, and liquidity-migration-fee rounding;
- devnet parity;
- Token-2022 and transfer-hook behavior;
- post-migration liquidity-accounting semantics;
- immutable versus mutable configuration fields;
- reusable configuration behavior;
- configurable versus fixed protocol and partner fee splits.

No implementation should turn an unresolved question into an undocumented assumption.

## 11. Out of scope for MVP

- full launchpad ecosystem;
- token discovery or social feed;
- portfolio management or trading terminal;
- arbitrary prediction markets;
- full governance stack;
- generalized DeFi protocol builder;
- transfer hooks as a core launch feature;
- mainnet deployment before devnet verification is reliable.

## 12. Web workflow implementation brief

The first web slice implements the first six Phase 7 tasks sequentially: structured Describe, optional prose input, reviewed validation, Compile, segment visualization, and scripted deterministic simulation. It stays inside the root package with React and Vite in `src/web` and a loopback-only Node API in `src/web-api`. The API orchestrates existing CLI/domain validators, the inverse solver, and the deterministic simulator; protocol mathematics remain outside the UI.

- Form economics remain decimal strings. Only asset decimals and segment counts are structural numbers.
- Prose is an optional design note, retained with the reviewed input. Automatic LLM interpretation is not implemented in this slice; users must enter its economic goals in the structured fields. Never imply the note was parsed or enforced.
- Require an explicit successful review before solving. Editing intent or solver configuration invalidates review and downstream results.
- Load the version-controlled compile fixture as an explicitly named demo configuration, show its objective weights and simulation assumptions, and allow editing the JSON configuration. Never infer missing fees, weights, clocks, or migration settings.
- Display up to three deterministically ranked **curve drafts**, their measured target conflicts, explanations, and SDK curve-validation evidence. Full configuration and supply validation remain pending, so deployment is blocked and verification remains `unverified`.
- Graph data and segment descriptions come from quantized curve math. Chart coordinates are presentation-only; economic values stay exact strings.
- Scripted simulation starts afresh on the selected candidate, uses explicit human-unit buy/sell amounts and clocks, retains ordered trade results, and distinguishes curve completion from DAMM migration. No randomness, wallet, transaction, or invented settlement is involved.
- This original slice acceptance covered field errors and review invalidation, reproducible domain-backed compilation/simulation, candidate selection, keyboard-accessible segment selection, and responsive layout. The later attack/audit/hardening UI and versioned report export are implemented; deployment and automatic AI parsing remain open.

### Next five web tasks

Implement sequentially: all five attack controls, evidence-backed audits, numeric-objective hardening with paired replay, advanced exact units, then workflow-state coverage. Reuse the existing attack parsers, audit rules, and hardening engines; do not implement protocol math in React.

- Attack configurations are explicit, editable fixture-derived JSON with atomic amounts, seeds, population, tick budget, and optional warm-up disclosed. Run against the selected draft, not an implicit first candidate. Fixed-fee timing sweeps are unsupported rather than silently changing the fee configuration.
- Audit requests retain source inputs and recompute domain evidence. Client-supplied findings or metrics are never authoritative. Display raw metrics, evidence references, remediations and trade-offs, and the complete editable versioned heuristic severity policy. Missing stochastic, paired stress, or migration-accounting evidence is unavailable, not zero risk.
- Hardening selects findings from the recomputed audit, adds explicit decimal-string numeric risk weights, preserves original intent/settings, and replays the same deterministic actions, explicitly configured stochastic population/seed, and attack configurations. Keep the baseline visible, show all comparison failures/partial results, and never optimize severity labels or promise improvement.
- The advanced view exposes exact encoded curve values and explicit settings with atomic, Q64.64, liquidity, basis-point, slot, and timestamp units. It is not a complete deployable SDK configuration.
- Acceptance: each attack is runnable or explicitly unsupported, repeatable inputs yield repeatable evidence, policy versions accompany every audit, hardening preserves targets or explains rejection, advanced values survive JSON serialization exactly, and editing upstream inputs invalidates downstream evidence. Loading, retry, validation, empty, unsupported, partial, and stale-response paths receive automated coverage. The versioned report artifact and Phase 7 workflow gates are complete; deployment and automatic AI parsing remain later tasks.

Current technical boundaries: `/api/attack`, `/api/audit`, and `/api/harden` are synchronous local orchestration with bounded work, not saved sessions. Audit snapshots retain inputs and full source evidence; hardening recomputes the audit and never accepts authoritative client findings. The web audit currently has no standalone stochastic buyer-cohort or paired late-capital-stress input, so those categories remain unavailable. Paired hardening requires an explicit retained script, attack configuration(s) without warm-ups, and a separately reviewed stochastic population/seed. The advanced view covers curve drafts and simulator assumptions only, not assembled SDK config parameters. These restrictions do not weaken domain support or claim deployment readiness.

### Final product-flow task: claims boundary

Close only the remaining modeled-outcomes checklist item. Use shared, stage-specific evidence notices visible without expanding details, rather than relying on the footer or raw snapshots. Keep domain calculations, policy thresholds, and verification status unchanged.

- A valid review checks input structure, not feasibility. Satisfied compile targets describe encoded curve calculations, not future demand, fundraising, or enforcement of unmeasured preferences. Show returned compile scope warnings beside the result.
- The curve graph is a mathematical relationship, not a time/demand forecast. Script completion and 100% curve progress do not prove on-chain migration or destination settlement.
- Attack completion means model execution, not immunity. Sample percentiles are not future bounds; retain partial/failed counts and distinguish unavailable evidence from zero risk.
- LOW/MODERATE/HIGH remain versioned, provisional demo heuristics, not safety certificates, industry standards, or protocol guarantees. Explain this visibly before the findings and retain each raw metric and policy version.
- Hardening completion is not proof of improvement. Qualify each comparison as specific to the tested inputs; unavailable comparisons receive no improvement assessment. Keep the baseline and non-deployable status visible.
- Acceptance: automated coverage of visible caveats across review, compile, curve, simulation, attacks, audit and hardening, including partial/unavailable outcomes, LOW severity, unchanged hardening, and mobile layout. The report artifact and Phase 7 product-flow gates are complete. Phase 8 now has read-only network/wallet checks, a fail-closed validation-before-builder boundary, a tested pinned-SDK complete-candidate validator and Devnet `create_config` transaction builder, a read-only SOL budget adapter, a message-bound public transaction preview/simulation adapter, and a digest-bound approval gate. They are not wired to the application or wallet submission path; pool creation, signing, deployment, and on-chain verification remain open.
