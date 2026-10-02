# Project Decisions

Decisions are recorded here with a status so unresolved protocol assumptions do not become accidental implementation rules.

## Accepted

| Topic | Decision | Reason |
| --- | --- | --- |
| Runtime | Node.js 22.12+ | The available environment is Node.js 22.14 and Node 22 is the initial runtime target. |
| Package manager | pnpm 10.18.3, pinned in `package.json` | The product spec uses pnpm for the initial CLI examples, and this version is installed in the workspace. |
| Initial repository shape | One root TypeScript package | Start with the CLI and domain engine; split into a monorepo only when actual boundaries justify it. |
| TypeScript module system | Node ESM with `NodeNext` resolution | Matches the Node CLI direction and supports strict checking. |
| Formatting and linting | Biome 2.5.15 | One pinned tool covers both formatting and linting. |
| Test runner | Vitest 5.0.3 with V8 coverage | Provides a TypeScript-friendly runner and coverage command. |
| Initial deployment network | Devnet only | Production deployment follows verified devnet behavior. |
| AI role | Intent interpretation and explanations only | All financial calculations, validation, simulation, and deployment correctness remain deterministic. |

## Open decisions and protocol questions

| Topic | Status | Needed before |
| --- | --- | --- |
| Quote asset for the first demo (for example SOL or USDC) | Open | Defining demo units and USD conversion assumptions |
| Token and quote decimals for demo fixtures | Open | Implementing amount and price conversions |
| Local-to-SDK parity tolerances | Open | Accepting math parity tests |
| Meteora SDK version and deployed program IDs | Open | Implementing protocol behavior |
| DBC curve point encoding, segment limit, and rounding | Open | Implementing curve math and solver validation |
| Migration surplus and post-migration accounting | Open | Simulator and deployment verification |
| Dynamic fee and scheduler behavior | Open | Fee simulation and fee-timing attack |

