# Demo input files

`demo-market.json` is a `MarketIntent` object as defined by `src/domain/market-intent.ts` and `spec.md` §7.1. It has no wrapper object or simulator-specific fields. Every economic decimal is a JSON string; asset decimals and `solver.maxSegments` are structural integers.

`demo-market.ts` is a separate Phase 3 simulator fixture. Its hand-authored curve and migration settlement are illustrative and explicitly unverified; they are not compiled from `demo-market.json` and do not establish that the intent constraints are satisfied. That connection belongs to the Phase 4 solver/compiler.

Validate the canonical intent and the sample fee and migration configurations with:

```sh
pnpm tymba validate examples/demo-market.json --fees examples/demo-fees.json --migration examples/demo-migration.json
pnpm tymba validate examples/demo-market.json --json
```

The optional configuration files represent protocol-sized integer fields as decimal strings at the JSON boundary. Add `--json` for a machine-readable validation report. Validation checks the domain contract; it does not establish Meteora SDK parity or devnet support.

`compile` accepts a request envelope with the canonical `marketIntent`, explicit objective weights, and explicit deterministic simulation configuration. Run the tracked request with:

```sh
pnpm tymba compile examples/demo-compile-request.json
pnpm tymba compile examples/demo-compile-request.json --json
```

At this phase the command returns simulator-checked, pinned-SDK curve-validated drafts but remains `blocked` and exits non-zero: their protocol `verificationStatus` remains `unverified` because complete DBC configuration and token-supply validation are not implemented. It emits no deployable candidate or protocol configuration. Passing only `examples/demo-market.json` also fails clearly because solver weights and simulation settings are not inferred.

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
