# Tymba

Tymba compiles desired token-market behavior into Meteora Dynamic Bonding Curve configurations, then simulates, attacks, audits, and prepares approved designs for deployment.

The product and technical source of truth is [`spec.md`](./spec.md). The MVP requirements and delivery checklist are in [`PRD.md`](./PRD.md) and [`todo.md`](./todo.md). Read [`AGENTS.md`](./AGENTS.md) before making project changes.

Product and architecture decisions are tracked in [`DECISIONS.md`](./DECISIONS.md). Verified protocol facts and remaining Meteora research items are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Current status

The repository contains the exact DBC math core and parity tests, a deterministic in-memory simulator, an illustrative scripted demo, and a validation CLI. The simulator and demo are modeled evidence, not an SDK-parity or on-chain guarantee. Consult [`todo.md`](./todo.md) and [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md) for implementation status and unresolved protocol checks.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.18.3

Install dependencies with:

```sh
pnpm install
```

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
