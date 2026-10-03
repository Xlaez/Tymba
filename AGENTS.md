# Tymba Agent Instructions

## Read first

DO not use comments in codes unless very neccessary.
This is a spec-led TypeScript implementation with domain math, simulation, attack, audit, and hardening workflows in progress. Before proposing, implementing, reviewing, or testing any product change:

1. Read the root [`spec.md`](./spec.md) in full.
2. Read the root [`PRD.md`](./PRD.md) in full.
3. Inspect the current repository tree and working state.
4. Treat the current Meteora SDK/program behavior as authoritative when it differs from either document.

The root directory is the project workspace. Keep project documentation and implementation artifacts inside it unless the user explicitly requests another location.

## Product context

Tymba is an inverse compiler and economic audit workflow for Meteora Dynamic Bonding Curve markets:

```text
desired market behavior → constraints → valid DBC configuration
                         → deterministic simulation → adversarial attack
                         → economic audit → hardening → deployment
```

It is market-design infrastructure, not a generic launchpad, trading terminal, AI trading bot, or guarantee of fundraising, safety, or manipulation resistance.

Use Tymba as the product name in all project artifacts.

## Source-of-truth rules

- `spec.md` is the canonical product and technical specification.
- `PRD.md` is the derived implementation brief and planning aid.
- The deployed Meteora program and official SDK are authoritative for protocol behavior, limits, formulas as implemented, integer representations, rounding, fee semantics, migration, and deployment.
- If code, documentation, or an assumption conflicts with the SDK/program, stop, record the discrepancy, verify it, and update the documentation rather than silently choosing a behavior.
- Never invent current Meteora details from memory. Validate SDK versions, segment limits, supply modes, fee behavior, migration, Token-2022, and transfer-hook semantics before relying on them.

## Scope and product boundaries

- Build the MVP in this order: DBC math, deterministic simulator, inverse solver, adversarial simulation, audit engine, UI, devnet deployment, then AI interpretation.
- The first useful milestone is a deterministic CLI; do not begin with a UI-only mock that bypasses the domain engine.
- Natural-language AI may parse intent and explain results. It must not be the authority for swap math, fees, migration thresholds, optimization validity, simulation outcomes, or deployment correctness.
- Do not claim that vanilla DBC provides per-wallet caps, oracle-driven curve rewrites, guaranteed fundraising, sniper immunity, or whale-proof ownership.
- Transfer hooks and other custom on-chain controls are advanced features and must be clearly separated from native DBC behavior.
- MVP excludes a full launchpad ecosystem, token discovery feed, social layer, portfolio management, trading terminal, arbitrary prediction markets, and full governance.

## Engineering constraints

- Keep domain calculations independent from UI, persistence, AI, and network side effects.
- Use exact integer or documented fixed-point arithmetic for on-chain quantities. Do not use casual floating-point arithmetic for values that affect transactions or parity checks.
- Make precision, scale, rounding direction, fee treatment, and overflow behavior explicit.
- Keep continuous economic optimization separate from DBC protocol math. Quantize candidates before simulation; user-visible metrics must come from the quantized candidate.
- Use `bigint` for atomic token amounts in domain code. Do not convert atomic values through JavaScript `number`; adapt to SDK-specific BN types only at the Meteora boundary when needed.
- Require exact SDK/program parity for protocol outputs by default. Any tolerance must be isolated to a specific helper and justified with evidence; its maximum is one atomic unit.
- Treat the demo as 9-decimal base and 6-decimal USD-stable quote, while keeping decimal counts metadata-driven.
- Keep the 16-entry public-builder curve limit distinct from the 20-entry legacy stored-config capacity. In the pinned SDK, one curve entry encodes one segment's upper sqrt-price boundary and liquidity, so 16 entries allow 16 segments and 17 sqrt-price boundaries including the start.
- Preserve reproducibility: solver and simulation results must be deterministic for the same inputs, SDK behavior, and random seed.
- Keep protocol adapters isolated so the simulator can be tested independently and SDK/devnet behavior can be compared explicitly.
- Prefer a small, reliable TypeScript implementation for the MVP. Add Rust services, Redis/BullMQ, worker pools, or distributed execution only when measured requirements justify them.
- Do not create the suggested monorepo structure speculatively; add boundaries as real implementation needs appear.
- Keep generated reports clear about whether a number is deterministic, simulated, adversarially modeled, or verified on-chain.

## Required verification

For every math or protocol change, add or update proportionate tests:

- unit tests for known segment quote/base calculations;
- multi-segment buy and sell tests;
- fee, migration, surplus, and allocation tests;
- property tests for monotonicity, reversibility within documented tolerances, and segment-sum behavior;
- Meteora SDK parity tests across generated valid configurations;
- devnet integration tests before claiming deployment correctness.

Do not treat a passing local approximation as proof of Meteora compatibility. Record tolerances and explain any intentional divergence.

## Security and economic safety

- Treat user-provided values, natural-language intent, imported configs, wallet addresses, and SDK responses as untrusted input.
- Validate all ranges, signs, segment ordering, allocation sums, supply requirements, fees, timestamps, and integer bounds before solving or broadcasting.
- Never broadcast a transaction without an explicit preview/validation path and a final user approval step.
- Keep private keys and wallet signing outside application logs, tests, reports, and error messages.
- Model and report adversarial behavior rather than presenting simulations as guarantees.
- Use severity labels such as `LOW`, `MODERATE`, and `HIGH` with supporting metrics; avoid unsupported composite safety scores.
- Avoid destructive changes, schema changes, dependency upgrades, or network writes unless they are explicitly required by the current task.

## Workflow for agents

Before coding:

1. Summarize the relevant requirement from `spec.md` and `PRD.md`.
2. Inspect existing files, package metadata, tests, and configuration.
3. Identify unresolved Meteora assumptions and verify them against the current SDK/program where applicable.
4. State the smallest implementation slice and its acceptance criteria.

While coding:

- Keep changes focused and explain non-obvious economic or protocol decisions.
- Preserve existing user changes and do not reset or overwrite unrelated work.
- Update types, tests, documentation, and fixtures together when behavior changes.
- Use seeded fixtures for demo simulations and never hide randomness in reported results.

Before handing off:

1. Run the narrowest relevant tests first, then broader checks where available.
2. Re-read the changed files and inspect the diff.
3. Report what was verified, what remains unverified, and any SDK/devnet dependency.
4. If a requirement is mathematically or technically unsatisfiable, say so plainly and show the measured conflict or alternative.

## Documentation and communication

- Use plain economic language in user-facing text and explain low-level DBC terms only when useful.
- Prefer “capital needed before graduation” to unexplained “migration quote threshold.”
- Prefer “opening sniper exposure” to raw fee-scheduler jargon.
- Every advanced parameter should state its economic effect.
- Distinguish modeled outcomes from promises: “the curve requires approximately…” and “under the tested scenarios…” are acceptable; “guaranteed to raise…” and “safe from…” are not.
- If a product decision would materially change architecture, economics, or protocol behavior, pause and ask the user instead of making a silent assumption.

## Current repository status

The workspace has a root TypeScript package, pinned pnpm lockfile, strict compiler configuration, Biome, Vitest, CI workflow, decision/protocol notes, and Git history. Phases 1–6 of `todo.md` are implemented: exact DBC math and SDK curve validation, deterministic simulation/CLI, inverse-solver curve drafts, seeded stochastic and five adversarial scenarios, metric-based economic audits, and hardening with paired replay comparisons. Audit severity uses the editable illustrative `demo-v1` policy; hardening comparisons remain modeled and candidates remain `unverified`. The demo migration settlement is illustrative and unverified. The web workflow/report export, end-to-end devnet deployment verification, and AI interpretation remain future work. Future agents must inspect the current state rather than assuming the suggested product architecture already exists.
