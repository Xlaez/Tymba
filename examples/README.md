# Demo input files

`demo-market.json` is a `MarketIntent` object as defined by `src/domain/market-intent.ts` and `spec.md` §7.1. It has no wrapper object or simulator-specific fields. Every economic decimal is a JSON string; asset decimals and `solver.maxSegments` are structural integers.

`demo-migration.json` is the versioned `demo-v1` **seeded Devnet deployment profile**, not a recommended production configuration. Its nested `migration` object preserves the original seeded migration values. The surrounding profile makes explicit the fixed 1B base supply, 9-decimal base token, 6-decimal Circle Devnet USDC candidate, disabled base-token vesting, one-day single-tranche DAMM v2 liquidity vesting assumption, zero pool-creation fee, runtime deployer roles, and simulator-only slot zero. `sdkMapping` spells out the customizable migration fee option and pinned SDK DAMM v2 time-linear base-fee mode with a zero-period market-cap scheduler. `allocationIntent` remains separate from the six SDK allocation buckets.

The metadata fixture is [`devnet-token-metadata.json`](./devnet-token-metadata.json), with the relative image [`devnet-token-metadata.svg`](./devnet-token-metadata.svg). Publish both at a stable HTTPS or IPFS location before resolving the metadata URI. The profile deliberately uses `DEVNET_METADATA_URI_REQUIRED`; no example or unverified URL may be used for a transaction.

`demo-market.ts` is a separate Phase 3 simulator fixture. Its hand-authored curve and migration settlement are illustrative and explicitly unverified; they are not compiled from `demo-market.json` and do not establish that the intent constraints are satisfied. That connection belongs to the Phase 4 solver/compiler.

Validate the canonical intent and the sample fee and migration configurations with:

```sh
pnpm tymba validate examples/demo-market.json --fees examples/demo-fees.json --migration examples/demo-migration.json
pnpm tymba validate examples/demo-market.json --json
```

The optional configuration files represent protocol-sized integer fields as decimal strings at the JSON boundary. The validator unwraps the versioned profile's `migration` member and validates the seeded migration contract. Add `--json` for a machine-readable validation report. This domain check does not establish live quote-mint support or on-chain deployment parity.

`compile` accepts a request envelope with the canonical `marketIntent`, explicit objective weights, and explicit deterministic simulation configuration. Run the tracked request with:

```sh
pnpm tymba compile examples/demo-compile-request.json
pnpm tymba compile examples/demo-compile-request.json --json
```

The compile command returns simulator-checked, pinned-SDK curve-validated drafts but remains `blocked` and exits non-zero: their protocol `verificationStatus` remains `unverified`, and the CLI emits no deployable candidate. The separate Phase 8 `buildCandidate()` API combines a draft with the explicit `demo-v1` profile and assembles/serializes a complete offline SDK candidate. It defers only receiver-dependent SDK supply validation until an actual deployer wallet is resolved; fixed-supply bounds are checked using pinned SDK helpers. Passing only `examples/demo-market.json` to `compile` still fails because solver weights and simulation settings are not inferred.

Run a seeded opening-sniper attack against the solver-generated curve draft with:

```sh
pnpm tymba attack examples/demo-attack-request.json --scenario sniper
pnpm tymba attack examples/demo-attack-request.json --scenario sniper --json
```

The attack request includes the market intent, solver weights, simulation configuration, agent distribution, attacker funding, and timing parameters. Its optional `preScenarioBuyQuoteAtomic` performs the same explicit deterministic warm-up before each selected attack, useful when a scenario needs pre-existing base holders. The report includes that assumption, labels outcomes as modeled, and keeps the curve marked as a non-deployable draft while full DBC configuration and token-supply validation remain pending.

The tracked attack request has fixtures for all five scenarios. Select `sniper` or `opening-sniper`, `whale-entry`, `pump-and-dump`, `sell-cascade`, or `fee-schedule-timing` with `--scenario`; each run deterministically compiles to the same curve-draft ID from the unchanged request.

Run the fixed, deterministic simulator fixture with:

```sh
pnpm tymba simulate
pnpm tymba simulate --advanced
pnpm tymba simulate --json
```

This command runs the hand-authored scenario in `demo-market.ts`; it is not compiled from the JSON intent. Its market outcomes are modeled, and the illustrative migration settlement is not protocol-parity verified.

Inspect the fixture's segment economics and migration metrics with:

```sh
pnpm tymba inspect
pnpm tymba inspect --advanced
pnpm tymba inspect --json
```

The inspection uses exact per-segment amount rounding for totals and human-unit formatting for display. It reports the same illustrative, unverified migration boundary as the simulator.

All CLI commands provide JSON output with `--json`. For `simulate` and `inspect`, `--advanced` adds an `advanced` object containing raw integer protocol values and detailed simulator state; the normal economic summary remains separate. Decimal economic values are serialized as strings.
