# Tymba

Tymba compiles desired token-market behavior into Meteora Dynamic Bonding Curve configurations, then simulates, attacks, audits, and prepares approved designs for deployment.

The product and technical source of truth is [`spec.md`](./spec.md). The MVP requirements and delivery checklist are in [`PRD.md`](./PRD.md) and [`todo.md`](./todo.md). Read [`AGENTS.md`](./AGENTS.md) before making project changes.

Product and architecture decisions are tracked in [`DECISIONS.md`](./DECISIONS.md). Verified protocol facts and remaining Meteora research items are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Current status

This repository is at the tooling and protocol-research stage. The DBC SDK is pinned to 1.5.13, and the initial quote/decimal and precision policies are recorded. DBC math, the solver, simulator, and deployment flow have not been implemented; protocol behavior still needs exact SDK parity before local calculations are relied on.

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

The test command allows an empty suite while the project is being scaffolded. Add domain tests with the first implementation slice.

## Initial architecture decision

Start with one root TypeScript package for the CLI and domain work. Split packages or add applications after the domain boundaries and user workflow are established.
