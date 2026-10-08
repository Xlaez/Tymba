# Tymba

Tymba compiles desired token-market behavior into Meteora Dynamic Bonding Curve configurations, then simulates, attacks, audits, and prepares approved designs for deployment.

The product and technical source of truth is [`spec.md`](./spec.md). The MVP requirements and delivery checklist are in [`PRD.md`](./PRD.md) and [`todo.md`](./todo.md). Read [`AGENTS.md`](./AGENTS.md) before making project changes.

Product and architecture decisions are tracked in [`DECISIONS.md`](./DECISIONS.md). Verified protocol facts and remaining Meteora research items are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Current status

Phases 1–6 implement exact DBC math and parity checks, deterministic/stochastic simulation, inverse curve solving, five adversarial scenarios, and metric-based audit/hardening. Phase 7 connects Describe, reviewed validation, ranked draft previews, curve explanations, deterministic scripts, all five attacks, evidence-backed audits, paired hardening comparisons, and advanced exact units. Versioned report export and the Phase 7 product-flow gates are complete. Phase 8 has a versioned seeded `demo-v1` Devnet profile, offline SDK candidate building and serialization, unsigned config-and-pool transaction assembly, and a Wallet Standard submission adapter behind the exact-preview approval gate. The sender is not connected to the studio. Metadata remains unpublished, so wallet submission is unavailable until a stable URI is resolved. No wallet prompt, signature, Devnet transaction, or on-chain verification has occurred. Modeled outputs remain unverified. Consult [`todo.md`](./todo.md) and [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md) for current limits.

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

After selecting a curve draft, **Devnet access check** can confirm the configured public Devnet endpoint and explicitly connect a Wallet Standard wallet. It checks the network identity and public account only. The browser does not build, sign, or send a transaction; it makes a read-only request to the fixed public RPC endpoint only when **Check Devnet connection** is selected.

Phase 8's seeded Devnet profile is [`examples/demo-migration.json`](./examples/demo-migration.json), version `demo-v1`. It retains the six seeded migration allocation buckets and visibly records the one-day DAMM v2 vesting assumption, the 9-decimal base / 6-decimal Devnet USDC assumptions, the simulator-only slot zero, and the pinned SDK's customizable migration fee plus time-linear DAMM v2 fee mode with no schedule progression. It is a judging/review fixture, not a recommended production configuration. The [`public/`](./public/) directory contains the static metadata files, and [`.github/workflows/deploy-demo-metadata.yml`](./.github/workflows/deploy-demo-metadata.yml) publishes only those files to GitHub Pages. The expected metadata URI is `https://xlaez.github.io/Tymba/devnet-token-metadata.json`, with the SVG at `https://xlaez.github.io/Tymba/devnet-token-metadata.svg`; these URLs are not usable until the Pages source is set to GitHub Actions and the workflow succeeds. The candidate remains at `DEVNET_METADATA_URI_REQUIRED` until publication is fetched and confirmed.

`buildCandidate()` compiles this fixture into a deterministic SDK candidate without a wallet or RPC request. `prepareDeployment()` validates and serializes the candidate. Before a runtime receiver exists, SDK configuration parameters are validated with the receiver-dependent supply check deferred; fixed-supply bounds are checked with pinned SDK helpers. The transaction path adds the explicitly connected deployer as the leftover receiver, payer, pool creator, and fee claimer, then runs the full pinned SDK configuration validator before assembling an unsigned transaction. `sendDeployment()` currently returns readiness only when the candidate, resolved wallet, resolved metadata URI, fixed Devnet identity, matching successful preflight and simulation, and explicit digest-bound approval all agree. It does not sign or broadcast. These APIs are tested with mocked Devnet responses; no live Devnet request or transaction was used for the fixture/candidate increment.

Evidence limits stay visible throughout the flow. Satisfied curve targets are not fundraising forecasts; script completion is not on-chain migration; attack percentiles are not future bounds; LOW severity is not a safety certificate. Hardening comparisons apply only to the tested inputs (or available partial evidence), and unavailable comparisons have no improvement assessment. The studio cannot sign or deploy transactions. Shared copy lives in `src/web/evidence.ts` with browser regression checks in `tests/e2e/evidence-claims.spec.ts`.

The default compile fixture uses fixed fees, so fee-schedule timing is explicitly unsupported. To exercise it, edit the compile configuration using the `objectiveWeights` and `simulation` objects from [`examples/demo-attack-request.json`](./examples/demo-attack-request.json), then review and compile again. This explicitly enables the fixture’s timestamp-based scheduled fees; attacks never change fees automatically. Attack JSON presets are references for 9-decimal base / 6-decimal quote assets, not inferred appropriate behavior for other markets. Web workloads are bounded to 10 iterations, 100 ticks/agents, 2,000 agent-ticks per run, and up to 98 scheduled fee periods.

The optional plain-English input is a retained design note, not an AI parser. Enter its economic goals in the structured fields. The editable configuration is explicitly loaded from [`examples/demo-compile-request.json`](./examples/demo-compile-request.json); its fees, weights, activation settings, and clocks are not inferred from preferences. Review is invalidated by edits. A satisfied core curve target remains an unverified curve draft. The offline `demo-v1` candidate API is scoped to its explicit seeded deployment profile; the studio still does not expose a deployable configuration or send flow.

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
