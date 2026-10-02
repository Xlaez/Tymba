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

### Reporting

Reports must distinguish:

- deterministic calculations;
- stochastic simulation results;
- adversarial scenario results;
- on-chain verified values.

Simulation output must be labeled as modeled evidence, not a prediction or guarantee.

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

Use a TypeScript monorepo only after the repository is initialized with the required tooling. Keep domain logic independent from UI and network side effects.

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
- maximum supported segment count;
- fixed versus dynamic supply constraints;
- dynamic-fee evolution and scheduler timing;
- migration overshoot and surplus recipient behavior;
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

