# Tymba

Tymba compiles desired token-market behavior into Meteora Dynamic Bonding Curve configurations, then simulates, attacks, audits, and prepares approved designs for deployment.

The product and technical source of truth is [`spec.md`](./spec.md). The MVP requirements and delivery checklist are in [`PRD.md`](./PRD.md) and [`todo.md`](./todo.md). Read [`AGENTS.md`](./AGENTS.md) before making project changes.

Product and architecture decisions are tracked in [`DECISIONS.md`](./DECISIONS.md). Verified protocol facts and remaining Meteora research items are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Current status

Phases 1–6 implement exact DBC math and parity checks, deterministic/stochastic simulation, inverse curve solving, five adversarial scenarios, and metric-based audit/hardening. Phase 7 now connects Describe, reviewed validation, ranked draft previews, curve explanations, deterministic scripts, all five attacks, evidence-backed audits, paired hardening comparisons, and advanced exact units. Outputs remain modeled/unverified; reports, complete configuration/supply validation, and devnet deployment are not implemented. Consult [`todo.md`](./todo.md) and [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md) for the remaining work.

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

Evidence limits stay visible throughout the flow. Satisfied curve targets are not fundraising forecasts; script completion is not on-chain migration; attack percentiles are not future bounds; LOW severity is not a safety certificate. Hardening comparisons apply only to the tested inputs (or available partial evidence), and unavailable comparisons have no improvement assessment. The studio cannot sign or deploy transactions. Shared copy lives in `src/web/evidence.ts` with browser regression checks in `tests/e2e/evidence-claims.spec.ts`.

The default compile fixture uses fixed fees, so fee-schedule timing is explicitly unsupported. To exercise it, edit the compile configuration using the `objectiveWeights` and `simulation` objects from [`examples/demo-attack-request.json`](./examples/demo-attack-request.json), then review and compile again. This explicitly enables the fixture’s timestamp-based scheduled fees; attacks never change fees automatically. Attack JSON presets are references for 9-decimal base / 6-decimal quote assets, not inferred appropriate behavior for other markets. Web workloads are bounded to 10 iterations, 100 ticks/agents, 2,000 agent-ticks per run, and up to 98 scheduled fee periods.

The optional plain-English input is a retained design note, not an AI parser. Enter its economic goals in the structured fields. The editable configuration is explicitly loaded from [`examples/demo-compile-request.json`](./examples/demo-compile-request.json); its fees, weights, activation settings, and clocks are not inferred from preferences. Review is invalidated by edits. A satisfied core curve target is not a deployable config; unsupported preferences and pending full-config/supply validation remain visible.

To run the built interface with the same local API:

```sh
pnpm build
pnpm start
```

Both commands serve only on `127.0.0.1:5173`. Stop any existing studio on that port before starting another. The API has no wallets, signing, RPC, database, external AI, or saved sessions. Reloading clears this in-memory workspace. Scripted runs use the selected draft, explicit clocks, and fresh initial state; curve completion is not destination migration.

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
