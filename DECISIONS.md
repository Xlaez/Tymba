# Project Decisions

Decisions record product choices separately from protocol claims that still need SDK or on-chain parity checks. Protocol research and source links are in [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md).

## Accepted product and architecture decisions

| Topic | Decision |
| --- | --- |
| Product name | Tymba is the canonical name throughout the project. |
| Demo quote semantics | Use a USD-stable quote asset. Use canonical USDC on mainnet (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). Circle Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) is the leading six-decimal, faucet-backed devnet candidate; adopt it only after the full DBC-to-DAMM v2 flow is verified. Otherwise use a controlled 6-decimal SPL test mint. |
| Demo decimals | Base token: 9 decimals. Quote token: 6 decimals. Represent decimals as token metadata, not a closed enum. Validate base decimals against Meteora’s current 6–9 rule; defer final quote-mint validation to the pinned SDK/program. |
| Amount representation | Use `bigint` for atomic token amounts in domain code. Convert to SDK-specific BN types only at the Meteora adapter boundary when required. Never route atomic quantities through JavaScript `number`. |
| Price presentation | DBC economics operate in quote/base units. USD rendering is a presentation concern driven by quote-asset metadata; the math core does not assume USD or an oracle. |
| Math boundaries | Keep continuous economic objectives and optimization separate from discrete DBC protocol math. Start as modules in the single root package (`src/economics` and `src/dbc-math`); create separately published/workspace packages only when repository boundaries justify it. |
| Candidate pipeline | Optimize a continuous economic candidate, quantize it to protocol integers, simulate and validate the quantized candidate, then display metrics from that final candidate. Never display idealized pre-quantization metrics as deployed economics. |
| Solver objective inputs | Do not hardcode objective weights or a price-impact probe size. Require six non-negative `Decimal` weights that sum exactly to one; require measurements for every positively weighted term. Normalize each term as documented in `spec.md` §7.5. |
| Parity policy | Require exact equality for protocol outputs, including encoded values, swaps, fees, and migration amounts. Default tolerance is zero atomic units and exact equality for Q64.64 values. A documented exception of at most one atomic unit may be introduced only for a specific SDK conversion helper after evidence shows exact parity is impossible. Human-readable display comparisons use formatting rules. |
| Fee implementation order | Implement fixed base fees first, then linear/exponential schedules and activation clock, then stateful dynamic fees by mirroring the SDK/program algorithm. Model total trading fee as base plus dynamic components, subject to protocol rules. |
| Simulation clock | Carry both timestamp and slot so fee scheduling and activation semantics can be modeled correctly. |
| TypeScript compiler | Pin TypeScript 5.9.3 because the pinned Meteora SDK declares a TypeScript `^5` peer dependency. |
| Network | Devnet only for MVP deployment. Mainnet deployment stays out of scope until devnet behavior is verified. |
| AI role | AI may parse and explain. It is never the authority for mathematical calculations, validation, simulation, or deployment correctness. |

## Accepted protocol integration pins

| Topic | Decision |
| --- | --- |
| DBC SDK | Pin `@meteora-ag/dynamic-bonding-curve-sdk` to exactly `1.5.13` and commit the lockfile. |
| Curve representation | A domain segment stores contiguous lower/upper Q64.64 sqrt-price boundaries and u128 liquidity as `bigint`. The pinned SDK encodes one segment per `curve` entry; 16 public entries allow 16 segments and 17 sqrt-price boundaries including the separate start. Keep the legacy 20-entry stored-config capacity separate. |
| DBC program | Mainnet and devnet ID: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`. |
| DBC pool authority | `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM`. |
| DAMM v2 program | Mainnet and devnet ID: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`. |
| DAMM v2 pool authority | `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC`. |
| Address management | Centralize program IDs and authorities in one adapter configuration and validate the selected network/program identity at integration boundaries. Do not scatter addresses through domain or UI code. |

## Still to verify before implementation relies on protocol details

- Whether Circle Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) completes the full DBC-to-DAMM v2 lifecycle on devnet, including live mint-account validation and successful migration. The public devnet RPC was unreachable from the research environment during the 2026-10-02 check.
- Exact SDK/program decimal validation and base/quote price conversion behavior.
- Exact integer rounding in every input/output, swap, fee, migration, surplus, and allocation path.
- Exact surplus partner/creator split rounding; migration-fee and protocol liquidity-migration-fee source amounts and rounding.
- Exact DAMM v2 atomic allocation rounding and locked-vesting validation in the pinned SDK/program.
- Exact fee-scheduler and dynamic-fee fixed-point parity at boundary cases, including fee split sequencing and deployed-program/SDK version alignment.
- Any differences between the selected SDK version, current deployed program, and current official docs.

The accepted product decisions above are closed. The protocol behavior rows remain verification tasks until parity tests or direct SDK/program inspection establish their exact behavior.
