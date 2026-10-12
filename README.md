# Tymba

Tymba compiles desired token-market behavior into Meteora Dynamic Bonding Curve configurations, then simulates, attacks, audits, and prepares approved designs for deployment.

The product and technical source of truth is [`spec.md`](./spec.md). The MVP requirements and delivery checklist are in [`PRD.md`](./PRD.md) and [`todo.md`](./todo.md). Read [`AGENTS.md`](./AGENTS.md) before making project changes.

Product and architecture decisions are tracked in [`DECISIONS.md`](./DECISIONS.md). Verified protocol facts and remaining Meteora research items are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Current status

Phases 1–6 implement exact DBC math and parity checks, deterministic/stochastic simulation, inverse curve solving, five adversarial scenarios, and metric-based audit/hardening. Phase 7 connects Describe, reviewed validation, ranked draft previews, curve explanations, deterministic scripts, all five attacks, evidence-backed audits, paired hardening comparisons, and advanced exact units. Versioned report export and the Phase 7 product-flow gates are complete. Phase 8 has a versioned seeded `demo-v1` Devnet profile, offline SDK candidate building, and a studio deployment flow for unsigned config-and-pool assembly, budget checks, transaction preview, simulation, digest-bound approval, and Wallet Standard submission. Runtime config and mint signer keys stay in page memory and are not sent to the local API. The metadata JSON and SVG are published and HTTP-checked on GitHub Pages. A `demo-v1` config and pool were approved through Phantom and finalized on Devnet; fetched state matches all 57 compared candidate fields exactly. The per-run record is [`examples/devnet-deployment-record.demo-v1.json`](./examples/devnet-deployment-record.demo-v1.json). The pool has not been traded or migrated, and its allocation/accounting lifecycle is unverified. The transaction preview undercounted metadata-account funding by 0.01 SOL; that estimate needs correction. Modeled outputs remain unverified. Phase 9 submission hardening results, the exact demo flow, and the verified/unverified split are in [Canonical seeded demo](#canonical-seeded-demo). Consult [`todo.md`](./todo.md) and [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md) for current limits.

## Canonical seeded demo

Phase 9 hardening run, 2026-10-12, from a fresh clone with `pnpm install --frozen-lockfile`. Every number below was measured in that run and is pinned by `src/web-api/canonical-demo.test.ts` and `tests/e2e/canonical-demo.spec.ts`. All attack, audit, and hardening values are **modeled**; only the Devnet config/pool values are **on-chain observations**.

### Run it

```sh
pnpm install --frozen-lockfile
pnpm dev                       # http://127.0.0.1:5173 (or: pnpm build && pnpm start)
```

In the studio:

1. **Validate & review**, tick the review box, **Create curve drafts**.
2. Click **Select draft 2**. This is the curve deployed on Devnet (`curve-quote-69618739077-80381260922-1`). Draft 1 differs from it by one atomic unit of quote split.
3. **Replay trade plan** (the default $5,000 buy, $10,000 buy, 1,000,000 MKT sell script).
4. **Attack My Market**, scenario *Opening sniper*. Replace the **Attack configuration JSON** with the contents of [`examples/demo-canonical-sniper.json`](./examples/demo-canonical-sniper.json) and **Run selected attack**.
5. Select scenario *Pump and dump* (keep its default JSON) and **Run selected attack**.
6. **Run economic audit**, then tick **Opening-sniper profitability** and the review box, then **Harden selected findings**.
7. **Download versioned audit report** for the modeled JSON artifact.

Browser check of this exact path: `pnpm test:web` (includes `canonical-demo.spec.ts`). Command-line equivalents:

```sh
pnpm tymba compile examples/demo-compile-request.json          # exits 1 by design: BLOCKED, 0 deployable, 13 drafts, solver satisfied
pnpm tymba attack examples/demo-attack-request.json --scenario sniper   # also: whale-entry, pump-and-dump, sell-cascade, fee-schedule-timing
```

The CLI `attack` command has no draft selector and always attacks generation-order draft #0 (`curve-quote-1-1-149999999998`) under a scheduled-fee request. That is a different draft from the studio/Devnet draft above, so its numbers are not the canonical values.

### Fixtures and seeds

| File | Role | Seeds |
| --- | --- | --- |
| [`examples/demo-compile-request.json`](./examples/demo-compile-request.json) | Intent: 1,000,000,000 MKT (9 decimals), $200,000 start FDV, $2,000,000 migration FDV, $150,000 quote target, 25% distribution, balanced profile, high sniper resistance, 3 segments, fixed 25 bps quote fee. | none (deterministic compile) |
| [`examples/demo-canonical-sniper.json`](./examples/demo-canonical-sniper.json) | Opening-sniper attack: $100 sniper buy, $200 sniper capital, one retail buyer of $5,000 per buy. | 73 |
| [`examples/demo-attack-request.json`](./examples/demo-attack-request.json) | Pump-and-dump (`attacks["pump-and-dump"]`) and the other CLI attacks. | 73, 81, 117, 91 |
| `src/web/Harden.tsx` default replay | Hardening stochastic population: one $10 retail buyer, 4 ticks, 1 iteration. | 73 (from the sniper fixture) |
| [`examples/demo-migration.json`](./examples/demo-migration.json) | `demo-v1` Devnet profile. | none |

The $5,000 retail demand in the canonical sniper fixture is an explicit modeling assumption, chosen to match the replay script's first trade. With the shipped default sniper fixture (a $10 retail buyer) the sniper loses $0.47 (LOW), and hardening shows zero change on every sniper metric (it can only swap to the near-identical sibling draft). The canonical result therefore depends on that demand assumption.

### Expected values (draft 2)

| Quantity | Value |
| --- | --- |
| Segments | 3 (liquidity `2871645843083279137381663757054216`, `5134453708290229753219281928666881`, `1`) |
| Start / migration price | 0.0002 / 0.002 USDC per MKT ($200,000 / $2,000,000 FDV) |
| Capital needed before graduation | 150,000 USDC (`150000000000` atomic) |
| Supply distributed before graduation | 25.00% (2,500 bps) |
| Replay: final price / net capital / distributed | 0.0002931564774 USDC / 14,668.320345 USDC / 60,578,099.044594841 MKT (6.05%) |
| Replay: max trade impact / max drawdown / quote fees | 28.52% / 0.69% / 38.23545 USDC |
| Replay: graduation progress | 9.77% (curve completion is not DAMM migration) |

### Expected attack result (modeled, p95 of 1 seeded iteration)

| Scenario | Result | demo-v1 severity |
| --- | --- | --- |
| Opening sniper (seed 73) | Attacker PnL +14.234231 USDC on $200 capital (711 bps); late buyers pay 2,868 bps more | MODERATE |
| Pump and dump (seed 117) | Attacker PnL +422.367006 USDC on a $10,000 entry; late-buyer loss 22.26%; peak-to-trough drawdown 23.97%; recovery capital 10,474.674916 USDC | MODERATE |
| Early price sensitivity (deterministic replay) | $10,000 buy moves price 28.52% | HIGH |
| "Mid-curve" price sensitivity (deterministic) | 90,000 bps (900%): the retained source is the solver's own whole-curve verification buy (150,375.93985 USDC in one trade, start to graduation price) | HIGH, by construction |

These describe the tested scenarios, not future markets. Severity labels come from the editable illustrative `demo-v1` policy and are not safety certificates.

### Expected hardening result (modeled, paired replay)

Selecting *Opening-sniper profitability* with attack-profitability weight 0.3 moves from draft `…69618739077-80381260922-1` to `curve-quote-84293029902-1-65706970097` with original targets unchanged (quote-target error 0, distribution error 0):

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| Opening-sniper return (bps of $200 capital) | 711 | 580 | −131 |
| Opening-sniper p95 profit (quote atomic) | 14,234,231 | 11,601,056 | −2,633,175 |
| Opening-sniper late-buyer disadvantage (bps) | 2,868 | 2,374 | −494 |
| Max single-trade price impact (bps) | 2,852 | 2,359 | −493 |
| Max replay drawdown (bps) | 69 | 55 | −14 |

"Improved" applies only to these inputs and seeds. The sniper return stays in the MODERATE band (≥ 500 bps) after hardening. The hardened draft is **not deployed**; the Devnet pool is the pre-hardening baseline.

### Devnet references (Solana Devnet, `demo-v1`)

| Item | Value |
| --- | --- |
| Create transaction (finalized, slot 510319004) | [`5myg5xbcY4iEYuD7TBf8PuRcfxJzHhkBZz7MKGsrYbfhcX9p62DHYbCf6Aj5aS5xixmUSHc4ZeoMKDjymJdKAPWR`](https://explorer.solana.com/tx/5myg5xbcY4iEYuD7TBf8PuRcfxJzHhkBZz7MKGsrYbfhcX9p62DHYbCf6Aj5aS5xixmUSHc4ZeoMKDjymJdKAPWR?cluster=devnet) |
| DBC config | [`9iYEWiGmsKaMBb1zEJxHYAJj6AY3VThSpDQkWPoTcSG7`](https://explorer.solana.com/address/9iYEWiGmsKaMBb1zEJxHYAJj6AY3VThSpDQkWPoTcSG7?cluster=devnet) |
| Virtual pool | [`8RVi5JkRQhUpgAbBkKgk54dgG4jbU3Wi9p7xrSRs26o4`](https://explorer.solana.com/address/8RVi5JkRQhUpgAbBkKgk54dgG4jbU3Wi9p7xrSRs26o4?cluster=devnet) |
| Base mint (MKT) | [`4TfEUmumxCbTP3sspSLrR6g6UTpEL5tpunNcJZjACGsY`](https://explorer.solana.com/address/4TfEUmumxCbTP3sspSLrR6g6UTpEL5tpunNcJZjACGsY?cluster=devnet) |
| Quote mint (Circle Devnet USDC) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Base / quote vault | `2vJQMnCeXVF1zRqAuQ3DxX1S1sk3JoPeXNrxtM37W8qG` / `5PeGUBsRwHabwjmTywRifbNMvdrnEzgAKHqJ1xW2hPEV` |
| Token metadata account | `3JmVYmXwEHFf2mUarTaeTQUaXDDG6wSCSVrmHhTnY2mr` |
| Deployer / fee payer | `8HvxrKCaZo3CK6q1Nb1qPGnx7vzmPqTQEupNFNoLpRn1` |

Full per-run record: [`examples/devnet-deployment-record.demo-v1.json`](./examples/devnet-deployment-record.demo-v1.json). On 2026-10-12 these were re-read from public Devnet RPC (read-only): the transaction is finalized with no error, the config and pool accounts are owned by the DBC program, the quote vault holds 0, the base vault holds the full 1,000,000,000 MKT, and the pool's only transaction is the create. Metadata JSON and SVG return HTTP 200 from GitHub Pages.

### Verified vs unverified

Verified:

- Exact DBC math against the pinned SDK 1.5.13 (unit, property, and parity tests); deterministic CLI and API output is byte-identical across repeated runs.
- The compiled draft passes the pinned SDK curve and full config validators; the deployed config and pool match the compiled candidate on all 57 compared fields with zero tolerance, and the deployed curve is identical to draft 2.
- A Phantom-approved config-and-pool transaction finalized on Devnet (one real wallet run). Wallet rejection, preflight rejection, on-chain failure, and invalid-signature paths are covered by mocked tests.

Not verified:

- Any trade, graduation, DAMM v2 migration, vesting release, surplus split, or fixed-supply cleanup on chain. No swap was ever sent to this pool.
- All attack, audit, hardening, and replay outputs are modeled evidence under stated assumptions, not predictions, guarantees, or on-chain results. The audit severity policy is an illustrative heuristic.
- The hardened draft has not been through candidate preparation or deployed.
- The deployment budget preview undercounted the metadata account by 10,000,000 lamports (0.01 SOL); the cause is not established.

### Known limitations

- **Degenerate segments.** Generated drafts include liquidity-`1` segments (draft 2's final segment). By the segment formulas such a segment absorbs almost no quote and distributes almost no base, so price crosses it almost discontinuously. The solver's `deterministic-atomic-target-splits-v1` allocation produces them; changing it would change the economics and needs a product decision.
- **Mid-curve HIGH finding.** The 90,000 bps "mid-curve" finding comes from the solver's whole-curve verification trade, not from a realistic trade size, so its HIGH label says nothing about ordinary buys. The early-curve 2,852 bps finding (a $10,000 buy) is the meaningful price-sensitivity measurement. The audit does not yet exclude verification trades from this category.
- **Sell cascade.** The shipped fixture completes on CLI draft #0 but ends `partial` (`cascade_not_observed`) on draft 2 under the studio's fixed-fee compile; it was not retuned. Fee-schedule timing is unsupported under the fixed-fee compile and runs only with the scheduled-fee configuration described below.
- **Natural language.** The optional prose box is an uninterpreted design note. No AI parsing exists.
- **Compile CLI.** `compile` always reports BLOCKED and exits 1; full configuration and supply validation run in the Deploy step with a connected wallet.
- **Hardening scope.** Only opening-sniper profitability and early-impact mappings are supported, and paired hardening needs attacks without warm-ups.
- **Dependencies.** `pnpm audit --prod` reports 7 advisories (3 high, 4 moderate), all transitive through the pinned `@meteora-ag/dynamic-bonding-curve-sdk` and `@solana/web3.js` (`bigint-buffer`, `toml`, `jayson`→`uuid`/`stream-json`). They were not upgraded because the SDK pin underlies the parity evidence.
- **Devnet only.** Mainnet deployment is disabled. The quote-mint end-to-end DBC-to-DAMM v2 gate is open.

### Verification status (Phase 9 run)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (fresh clone) | passed |
| `pnpm check` (format, lint, both TypeScript projects, tests) | passed: 352 tests in 74 files |
| `pnpm coverage` | passed; 72.02% statements, 76.31% branches, 93.48% functions |
| `pnpm build` | passed |
| `pnpm test:web` (dev server) / `TYMBA_WEB_TEST_BUILT=1 pnpm test:web` (built server) | 21 / 21 passed each |
| CLI: validate, compile, 5 attacks, simulate, inspect (run twice) | outputs byte-identical; compile exits 1 by design |
| Live Devnet read-only re-check | tx finalized, accounts present, pool untouched |

This Phase 9 pass also fixed three stale unit tests (wallet sender, market builder) and two stale browser checks, a mobile horizontal-overflow bug from long digests in the Deploy panel, a truncated pool-authority address in the deployment record, and four inaccurate user-facing strings. See `git log` for the exact change.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.18.3

Install dependencies with:

```sh
pnpm install
```

## Run the web studio

From the root directory:

```sh
pnpm dev
```

Open [the local studio](http://127.0.0.1:5173). Follow the visible guide: set goals, check the values, create and compare curve drafts, replay trades, try modeled pressure, then review evidence and changes. Confirm the reviewed intent/configuration before selecting **Create curve drafts**. Select a draft, explore its curve sections, and run or edit the trade plan.

Then choose **Attack My Market**, inspect its editable atomic-unit assumptions, and run one or more models. **Run economic audit** recomputes retained source inputs and shows raw measurements, supporting evidence, remediations, and the versioned illustrative `demo-v1` severity policy. Missing source runs are unavailable, not zero risk. Editing inputs clears dependent results; reloading clears the workspace.

For **Harden Market**, retain a deterministic script and at least one attack, select findings, review the numeric risk weights and explicit stochastic replay population, confirm, and run the paired comparison. Opening-sniper profitability is supported; early-impact optimization also needs a first-buy finding matching an explicit compile probe. Other mappings explain why they are unsupported. Original targets/settings stay unchanged; improvement is not guaranteed. Attack warm-ups are currently unsupported in paired hardening replay. Expand the advanced view on either draft for exact atomic amounts, Q64.64 boundaries, liquidity scalars, and units.

After running an audit, select **Download versioned audit report** to save a JSON artifact for the selected curve draft. Version 1 retains the intent, solver and SDK versions, exact candidate parameters, replay inputs and random seeds, findings, audit policy, and source evidence. Deterministic and fee-schedule runs are labeled as seedless. The export is modeled evidence, remains unverified, and contains no credentials or wallet signing material.

After selecting a curve draft, the Deploy section can prepare the seeded demo candidate offline. The user must explicitly confirm Devnet, connect a compatible Wallet Standard wallet, enter or select the published metadata URI, and request unsigned transaction assembly. The studio displays the account budget, public addresses, instruction summary, and simulation result before the user can approve and send. Runtime config and mint keypairs exist only in page memory. No send occurs during candidate preparation, transaction assembly, budgeting, or simulation.

Phase 8's seeded Devnet profile is [`examples/demo-migration.json`](./examples/demo-migration.json), version `demo-v1`. It retains the six seeded migration allocation buckets and visibly records the one-day DAMM v2 vesting assumption, the 9-decimal base / 6-decimal Devnet USDC assumptions, the simulator-only slot zero, and the pinned SDK's customizable migration fee plus time-linear DAMM v2 fee mode with no schedule progression. It is a judging/review fixture, not a recommended production configuration. The [`public/`](./public/) directory contains the static metadata files, and [`.github/workflows/deploy-demo-metadata.yml`](./.github/workflows/deploy-demo-metadata.yml) publishes and checks them on GitHub Pages. The verified metadata URI is `https://xlaez.github.io/Tymba/devnet-token-metadata.json`, and its SVG is `https://xlaez.github.io/Tymba/devnet-token-metadata.svg`. The candidate fixture remains at `DEVNET_METADATA_URI_REQUIRED`; callers must explicitly resolve it with the published JSON URI before transaction assembly.

`buildCandidate()` compiles this fixture into a deterministic SDK candidate without a wallet or RPC request. `prepareDeployment()` validates and serializes the candidate. Before a runtime receiver exists, SDK configuration parameters are validated with the receiver-dependent supply check deferred; fixed-supply bounds are checked with pinned SDK helpers. The transaction path adds the explicitly connected deployer as the leftover receiver, payer, pool creator, and fee claimer, then runs the full pinned SDK configuration validator before assembling an unsigned transaction. `sendDeployment()` evaluates readiness for the matching candidate, wallet, metadata URI, fixed Devnet identity, successful preflight and simulation, and digest-bound approval. The final studio action then invokes the connected wallet for that reviewed transaction. Phantom approved the first `demo-v1` config-and-pool transaction; it finalized on Devnet and fetched state matches all 57 compared candidate fields. See [`examples/devnet-deployment-record.demo-v1.json`](./examples/devnet-deployment-record.demo-v1.json). The transaction preview undercounted metadata-account funding by 10,000,000 lamports (0.01 SOL); the cause remains under investigation, so the budget estimate is not verified. No swap or migration was sent.

Evidence limits stay visible throughout the flow. Satisfied curve targets are not fundraising forecasts; script completion is not on-chain migration; attack percentiles are not future bounds; LOW severity is not a safety certificate. Hardening comparisons apply only to the tested inputs (or available partial evidence), and unavailable comparisons have no improvement assessment. The studio can submit the explicitly approved Devnet config-and-pool transaction; the pool's trade, migration, and allocation lifecycle remain unverified. Shared copy lives in `src/web/evidence.ts` with browser regression checks in `tests/e2e/evidence-claims.spec.ts`.

The default compile fixture uses fixed fees, so fee-schedule timing is explicitly unsupported. To exercise it, edit the compile configuration using the `objectiveWeights` and `simulation` objects from [`examples/demo-attack-request.json`](./examples/demo-attack-request.json), then review and compile again. This explicitly enables the fixture’s timestamp-based scheduled fees; attacks never change fees automatically. Attack JSON presets are references for 9-decimal base / 6-decimal quote assets, not inferred appropriate behavior for other markets. Web workloads are bounded to 10 iterations, 100 ticks/agents, 2,000 agent-ticks per run, and up to 98 scheduled fee periods.

The optional plain-English input is a retained design note, not an AI parser. Enter its economic goals in the structured fields. The editable configuration is explicitly loaded from [`examples/demo-compile-request.json`](./examples/demo-compile-request.json); its fees, weights, activation settings, and clocks are not inferred from preferences. Review is invalidated by edits. A satisfied core curve target remains an unverified curve draft. The offline `demo-v1` candidate API is scoped to its explicit seeded deployment profile; the studio deployment flow is Devnet-only and requires the user to review and approve each transaction.

To run the built interface with the same local API:

```sh
pnpm build
pnpm start
```

Both commands serve only on `127.0.0.1:5173`. Stop any existing studio on that port before starting another. The local API has no wallet, signing, RPC, database, external AI, or saved-session integration. The browser's Devnet preflight calls only the fixed public RPC endpoint when requested. Reloading clears this in-memory workspace. Scripted runs use the selected draft, explicit clocks, and fresh initial state; curve completion is not destination migration.

Browser workflow checks:

```sh
pnpm test:web
```

Local tests use installed Google Chrome; CI installs Playwright Chromium. To check the built app instead of the development server, run `TYMBA_WEB_TEST_BUILT=1 pnpm test:web` after `pnpm build` with no studio already running. The domain/adapter suite remains `pnpm check`; browser tests are separate because they require a local server and browser.

## Project checks

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm check
```

Validate the demo intent and its optional fee and migration configurations:

```sh
pnpm tymba validate examples/demo-market.json --fees examples/demo-fees.json --migration examples/demo-migration.json
pnpm tymba validate examples/demo-market.json --json
```

Add `--json` for machine-readable output. Intent decimal values and protocol-sized configuration integers use JSON strings; validation failures return a non-zero exit code and field paths.

The `simulate` and `inspect` commands also accept `--json`. Their default reports use economic units; combining `--json` with `--advanced` nests raw atomic, Q64.64, and simulator-state values under the `advanced` key. Economic JSON quantities are strings to avoid numeric precision loss.

Run the deterministic scripted demo simulation:

```sh
pnpm tymba simulate
pnpm tymba simulate --advanced
pnpm tymba simulate --json
pnpm tymba simulate --json --advanced
```

This runs the explicitly illustrative fixture in [`examples/demo-market.ts`](./examples/demo-market.ts), not a compiled version of the JSON intent. Its outputs are modeled and the migration settlement is unverified.

Inspect each scripted curve segment and the migration metrics:

```sh
pnpm tymba inspect
pnpm tymba inspect --advanced
pnpm tymba inspect --json
pnpm tymba inspect --json --advanced
```

The test suite covers domain math, Meteora SDK parity, simulator behavior, and CLI report generation. `pnpm check` is the canonical local verification command.

## Initial architecture decision

Start with one root TypeScript package for the CLI and domain work. Split packages or add applications after the domain boundaries and user workflow are established.
