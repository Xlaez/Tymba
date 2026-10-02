# Tymba — Product & Technical Specification

> **Working name:** Tymba  
> **Tagline:** Design. Attack. Deploy.  
> **One-line product:** A compiler, simulator, and economic audit engine for Meteora Dynamic Bonding Curve (DBC) markets.

---

## 1. Executive Summary

Tymba turns human-readable token-launch goals into valid Meteora DBC configurations, simulates how those configurations behave under realistic and adversarial trading conditions, explains the resulting economics in plain English, and deploys approved configurations to Meteora.

Meteora DBC exposes a powerful but low-level market primitive:

- starting price,
- up to 16 public-builder curve entries (one per segment; legacy stored configs may contain up to 20 entries),
- migration threshold,
- fee schedules,
- dynamic fees,
- supply behavior,
- migration settings,
- post-migration liquidity allocation,
- vesting / locking,
- partner / creator economics.

The current developer experience is parameter-first:

> configure DBC parameters → observe what market behavior they produce.

Tymba inverts that relationship:

> describe desired market behavior → solve for DBC parameters → simulate → attack → audit → deploy.

The primary technical innovation is an **inverse DBC solver** constrained by Meteora's actual bonding-curve mathematics.

The primary product innovation is making DBC understandable in terms of economic intent rather than protocol parameters.

The primary demo innovation is an adversarial workflow:

> "Describe the launch you want."  
> → Compile  
> → Simulate  
> → Attack My Market  
> → Improve  
> → Deploy to Meteora

This should not be positioned as another token launchpad or visual curve editor. It is **market-design infrastructure** for DBC.

---

# 2. Product Thesis

## 2.1 Core thesis

Meteora DBC should be thought of as a **programmable market-formation primitive**, not merely a meme-token launch mechanism.

The difficult problem is not creating a DBC pool. The difficult problem is selecting parameters that produce the market behavior a creator actually intends.

A creator typically thinks in terms such as:

- "I want to raise roughly $100,000 before graduation."
- "I want about 25% of supply distributed before migration."
- "I want early participants to benefit, but not absurdly."
- "I want the market to absorb large buys without immediately going vertical."
- "I want strong sniper resistance in the opening minutes."
- "I want to graduate near a $1M FDV."
- "I want 40% of migrated liquidity locked for one year."

Meteora itself works in lower-level concepts such as:

- square-root prices,
- liquidity values,
- curve points,
- migration quote thresholds,
- base-fee schedulers,
- dynamic-fee controls,
- migration allocations,
- token-supply modes.

Tymba is the translation layer between the two.

---

## 2.2 What Tymba is

Tymba is four tightly integrated systems:

1. **Intent Compiler**  
   Converts plain-English or structured launch goals into machine-readable constraints.

2. **Inverse Curve Solver**  
   Searches the legal Meteora DBC configuration space for curve parameters satisfying those constraints.

3. **Simulation & Adversarial Engine**  
   Runs deterministic and stochastic trading scenarios against the generated market.

4. **Economic Audit + Deployment Layer**  
   Explains risks, compares alternatives, and deploys a valid configuration using Meteora's SDK.

---

## 2.3 What Tymba is not

Tymba is not:

- a generic token launchpad,
- a DBC chart viewer,
- a trading terminal,
- an AI trading bot,
- a generic tokenomics chatbot,
- an arbitrary smart-contract language,
- a guarantee of fundraising success,
- a guarantee against whales or manipulation.

The product should never imply that DBC can enforce behaviors it cannot enforce.

---

# 3. DBC Mental Model

A DBC launch is modeled as a sequence of increasing-price liquidity segments.

Each segment has:

- lower price `P0`,
- upper price `P1`,
- virtual liquidity `L`.

Within a segment, price movement follows concentrated-liquidity / constant-product style mathematics.

The critical relationships are:

## 3.1 Quote required to traverse a segment

```text
Q = L * (sqrt(P1) - sqrt(P0))
```

Where:

- `Q` = quote asset absorbed,
- `L` = virtual liquidity,
- `P0` = starting price of the segment,
- `P1` = ending price of the segment.

Interpretation:

> More liquidity means more quote capital is required to move through the same price range.

Therefore:

- low `L` → price moves quickly,
- high `L` → price moves slowly.

---

## 3.2 Base tokens distributed through a segment

```text
B = L * (1 / sqrt(P0) - 1 / sqrt(P1))
```

Where:

- `B` = base tokens distributed while moving through the segment.

This means each segment determines both:

- how much capital must enter,
- how much token supply leaves the curve.

---

## 3.3 Migration threshold

The migration quote threshold can be interpreted approximately as the total quote required to traverse configured segments until the migration point:

```text
Q_migration = Σ Li * (sqrt(Pi) - sqrt(Pi-1))
```

The launch remains on DBC until the relevant migration condition is met.

After migration, liquidity moves to Meteora's post-bonding liquidity mechanism, such as DAMM v2.

---

## 3.4 Important constraint

DBC is **not an arbitrary mathematical-function engine**.

Tymba must treat the following as hard constraints:

- curve prices must increase,
- each segment requires positive liquidity,
- the number of curve segments is bounded,
- market behavior is controlled indirectly through price ranges + virtual liquidity,
- DBC itself does not natively enforce per-wallet ownership caps,
- DBC itself does not continuously rewrite its curve based on external oracle events.

This constraint should shape both the UI and optimizer.

## 3.5 Protocol precision and candidate pipeline

The equations above describe the continuous economic model. They are not a substitute for Meteora's integer implementation or the exact values returned by the SDK.

For the initial demo:

- use a 9-decimal base token and a 6-decimal USD-stable quote asset;
- represent token decimals as metadata, not a fixed enum;
- represent atomic amounts as `bigint` throughout domain code;
- convert to an SDK-specific BN representation only inside the Meteora adapter when required;
- do not pass atomic token quantities through JavaScript `number`;
- represent encoded square-root prices using the SDK/program's Q64.64 integer format (`u128` on chain).

Human price means quote-token units per one base-token unit. Convert it to the atomic quote/base ratio with `price * 10^(quoteDecimals - baseDecimals)`. Encode the positive Q64.64 square-root price as `floor(sqrt(atomicPrice) * 2^64)` using exact decimal-rational and integer arithmetic; reject encoded values outside positive `u128`. Decode with `sqrtPriceQ64x64^2 / 2^128 * 10^(baseDecimals - quoteDecimals)` into arbitrary-precision `Decimal`. Do not use JavaScript `number` for prices or the decimal-scale factor. Base decimals must be 6–9 and quote decimals 0–255.

The pinned SDK's `getSqrtPriceFromPrice` follows the same equation and floors, but its finite-precision Decimal helper can produce different Q64.64 integers for some supported decimal/price combinations. Tymba's domain conversion therefore uses exact rational quantization and the adapter must pass the resulting raw sqrt-price boundaries to `buildCurveWithCustomSqrtPrices`; do not claim universal parity with the SDK convenience helper. The 9/6 demo examples match it. The discrepancy and pinned-version evidence are tracked in `PROTOCOL_NOTES.md`; final SDK configuration validation and parity of the resulting curve remain required.

Keep continuous economic calculations and discrete DBC protocol calculations in separate modules. The economic solver may produce approximate objective values; a protocol compiler must quantize its candidate to on-chain integers. Run simulation, validation, and SDK parity against that quantized candidate. All metrics shown to users must come from this final candidate, not from idealized pre-quantization values.

Protocol parity is exact by default: zero atomic-unit tolerance for amounts and fees, and exact integer equality for encoded Q64.64 values. A specific SDK helper may receive a documented tolerance of at most one atomic unit only if evidence shows its conversion boundary cannot match exactly. Display-format comparisons are separate from protocol parity.

The program's amount calculations use explicit rounding. Required input is rounded up and delivered output is rounded down where the corresponding protocol operation specifies those directions. Keep rounding explicit in low-level math primitives and verify every swap path against the pinned SDK/program.

The public-builder `curve` array accepts at most 16 entries, with one entry per segment. A sqrt-price boundary list therefore contains the starting boundary plus one boundary per entry, for at most 17 boundaries and 16 segments. Legacy on-chain configurations may contain up to 20 stored entries; imported-config support must keep that capacity separate from generated public-builder curves.

---

# 4. Product Goals

## 4.1 Primary goals

Tymba should allow a creator to:

1. Define a desired launch outcome in economic language.
2. Determine whether that outcome is mathematically achievable with Meteora DBC.
3. Generate one or more legal DBC curve configurations.
4. Understand why the configuration was selected.
5. Simulate deterministic launch behavior.
6. Run realistic market simulations.
7. Run adversarial attacks.
8. Identify economic weaknesses.
9. Compare revised configurations.
10. Deploy an approved result to Meteora.

---

## 4.2 Secondary goals

The platform should eventually support:

- reusable launch strategies,
- config auditing for third-party DBC pools,
- API / SDK access,
- agent integration,
- historical calibration using real Meteora launch behavior,
- saved simulation profiles,
- team review workflows,
- public "economic audit" reports.

---

# 5. User Ergonomics

The UX must optimize for one idea:

> Users think in outcomes. Protocols think in parameters.

Tymba should therefore avoid exposing protocol jargon as the primary interface.

---

## 5.1 Primary workflow

```text
DESCRIBE
   ↓
COMPILE
   ↓
SIMULATE
   ↓
ATTACK
   ↓
AUDIT
   ↓
DEPLOY
```

These should be the conceptual stages of the application.

---

## 5.2 Step 1 — Describe

The user can use either:

### Structured mode

```text
Token supply:             1,000,000,000
Starting FDV:             $200,000
Target graduation FDV:    $2,000,000
Capital target:           $150,000
Target distributed supply: 25%

Early-buyer advantage:
[ Low ─────●──── High ]

Price stability:
[ Sensitive ───●── Deep ]

Sniper resistance:
[ Low ─────────● High ]

Post-migration liquidity:
Creator locked: 40%
Partner locked: 20%
Unlocked: 40%

Creator lock duration:
12 months
```

### Natural-language mode

Example:

> I have 1 billion tokens. Start around $200k FDV, graduate near $2m, raise around $150k, distribute roughly 25% before migration, give early users some upside but keep the first phase from being too easy to snipe.

The LLM should translate natural language into structured constraints.

The LLM must **not** invent or directly generate low-level DBC parameters without validation.

---

## 5.3 Step 2 — Compile

The interface should return one of:

```text
✓ Economically satisfiable
```

or:

```text
⚠ Partially satisfiable
```

or:

```text
✕ Constraints conflict
```

Example:

```text
✓ Economically satisfiable

3 DBC segments
$150,000 migration quote target
24.8% projected pre-migration distribution
$1.96M modeled migration FDV
```

If constraints conflict, explain why.

Example:

> A $150k capital target, $200k starting FDV, $2M migration FDV, and 60% pre-migration distribution cannot all be satisfied simultaneously under the selected supply and segment constraints.

Then offer mathematically valid alternatives.

---

## 5.4 Step 3 — Explain

Every generated config should have an explanation layer.

Example:

### Phase 1 — Price Discovery

```text
Price:
$0.00020 → $0.00035

Capital absorption:
$11,800

Supply distributed:
6.0%
```

Explanation:

> This phase intentionally uses lower virtual liquidity so initial demand can establish price. The opening fee schedule is elevated to reduce the attractiveness of immediate sniper entry.

### Phase 2 — Distribution

> Liquidity increases significantly, allowing more capital and more buyers to enter without equally aggressive price movement.

### Phase 3 — Graduation

> The final segment allows stronger price discovery while targeting the remaining quote required for migration.

Do not show raw integer sqrt-price representations unless the user explicitly opens "Advanced".

---

# 6. Economic Model

## 6.1 Market objectives

The initial demo uses a USD-stable quote asset: canonical USDC on mainnet and a controlled six-decimal SPL test mint on devnet if it supports the complete DBC-to-DAMM v2 flow. The domain model stores quote mint, decimals, symbol, and an optional USD-peg display hint. DBC calculations remain denominated in quote/base units; USD is a presentation conversion and must not enter the core math.

The optimizer should support these first-class economic objectives:

### Capital objective

```text
Target capital before migration
```

Example:

```text
$100,000 ± 5%
```

---

### Distribution objective

```text
Target base-token percentage distributed before migration
```

Example:

```text
25% ± 2%
```

---

### Price objective

Examples:

```text
Starting price
Starting FDV
Migration price
Migration FDV
```

---

### Price-impact objective

Example:

> A $5,000 buy during the first phase should move price by no more than 8%.

This becomes a measurable optimizer constraint.

---

### Early-participant advantage

This must not be represented as an ownership guarantee.

Instead define measurable properties such as:

```text
price paid by earliest X% of capital
vs
median pre-migration price
```

Possible metric:

```text
early_advantage =
1 - average_price(first 10% quote inflow)
    / average_price(total quote inflow)
```

---

### Launch sensitivity

This represents how quickly price reacts to quote inflow.

A user-facing spectrum:

```text
Stable / Deep
Balanced
Momentum / Sensitive
```

Internally this influences liquidity allocation across segments.

---

## 6.2 Fee economics

Tymba should model:

- fixed base fees,
- fee schedulers,
- linear decay,
- exponential decay,
- dynamic / volatility fees,
- creator / partner / protocol fee splits where applicable,
- migration fees,
- post-migration fee behavior.

The simulator should expose:

```text
Total fees generated
Effective buyer fee
Effective seller fee
Creator fee revenue
Partner fee revenue
Protocol fee
```

where calculable.

Treat the base-fee scheduler and dynamic volatility fee as separate components of the total trading fee. The simulation clock must carry both timestamp and slot because activation and scheduler behavior can use either. Implement fixed fees first, scheduled base fees second, and stateful dynamic fees only after mirroring and parity-testing the SDK/program state machine.

---

## 6.3 Surplus

The engine must model quote surplus at migration.

Example:

```text
Migration threshold: 100 SOL
Final purchase moves reserve to: 105 SOL
Surplus: 5 SOL
```

Model surplus as quote reserve above the migration threshold. Keep it separate from amounts migrated into DAMM v2 and from configurable migration fees. Track protocol, partner, and creator surplus claims independently, including the exact split and integer rounding used by the selected SDK/program version.

The program constants currently define an 80% partner/creator share of surplus and a 20% protocol share. The partner/creator amount is then split according to configuration. The protocol also defines a 20 bps (0.2%) liquidity migration fee. Treat these as versioned protocol values and verify exact application to base and quote amounts against the pinned SDK/program before relying on them.

Maintain explicit ledgers for pool reserves, accrued trading fees, surplus, configurable migration fees, protocol migration-liquidity fees, DAMM v2 liquidity, and fixed-supply leftovers. Do not combine these into a single balance.

The accounting boundary should expose components separately, for example:

```ts
type AssetSide = "base" | "quote";

type AssetAmount<Asset extends AssetSide = AssetSide> = {
  asset: Asset;
  amount: CurrencyAmount;
};

type AssetAmountPair = {
  base: CurrencyAmount;
  quote: CurrencyAmount;
};

type EconomicLedger = {
  pool: AssetAmountPair;
  fees: {
    totalTrading: AssetAmountPair;
    protocol: AssetAmountPair;
    partner: AssetAmountPair;
    creator: AssetAmountPair;
    referral: AssetAmountPair;
  };
  surplus: {
    protocol: AssetAmount<"quote">;
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  };
  migration: {
    partnerFee: AssetAmount<"quote">;
    creatorFee: AssetAmount<"quote">;
    protocolLiquidityFee: AssetAmountPair;
    dammLiquidity: AssetAmountPair;
  };
  leftoverBase: AssetAmount<"base">;
};
```

All surplus and configurable migration-fee amounts in this ledger are quote-token amounts. Protocol migration-liquidity fees and DAMM v2 deposits track base and quote separately. `totalTrading` is an aggregate and must not be added again to its recipient components. The SDK-reported trading, protocol, and referral fee amounts are retained separately; whether they are additive is determined by the parity-tested accounting path.

The audit should include:

```text
Expected surplus under normal conditions
High-percentile surplus
Who receives surplus
```

---

## 6.4 Supply modes

Tymba should distinguish:

### Dynamic supply

Supply requirements are derived from curve + migration + vesting needs.

### Fixed supply

Creator specifies supply explicitly.

Fixed supply may produce leftovers.

The audit should show:

```text
Total supply
Curve allocation
Migration allocation
Vesting allocation
Expected leftovers
Leftover receiver
```

After DAMM v2 migration, track creator and partner liquidity allocations separately across unlocked, permanently locked, and vesting positions. Their configured allocations must sum to 100%. Current protocol constants require at least 10% locked on day one and cap lock duration at two years; enforce these through SDK/program-backed validation.

---

# 7. Inverse DBC Solver

This is the core technical differentiator.

---

## 7.1 Input

The public/API/UI boundary uses one canonical `MarketIntent`. All economic decimal values are plain decimal strings; JavaScript `number` is not used for prices, FDV, supply, quote targets, percentages, or atomic amounts. `decimals` and `maxSegments` are structural integer fields, not economic decimal values.

`totalBase` and `quoteToMigration` are human-readable token units and are converted using the corresponding asset decimals. FDV is a quote-denominated human economic target, not a token amount. Percentage strings are human percentages, so `"25"` means 25%.

```ts
type DecimalString = string;

type AssetDefinition = {
  symbol: string;
  decimals: number;
  mint?: string;
};

type MarketIntent = {
  assets: {
    base: AssetDefinition;
    quote: AssetDefinition;
  };
  supply: {
    totalBase: DecimalString;
  };
  pricing: {
    startPrice?: DecimalString;
    startFdv?: DecimalString;
    migrationPrice?: DecimalString;
    migrationFdv?: DecimalString;
  };
  targets: {
    quoteToMigration?: DecimalString;
    baseDistributionPct?: DecimalString;
  };
  preferences?: {
    launchProfile?: "deep" | "balanced" | "momentum";
    maxEarlyPriceImpactPct?: DecimalString;
    earlyBuyerAdvantagePct?: DecimalString;
    sniperResistance?: "low" | "medium" | "high";
  };
  solver?: {
    maxSegments?: number;
  };
  migration?: {
    creatorLockedPct?: DecimalString;
    partnerLockedPct?: DecimalString;
    unlockedPct?: DecimalString;
    lockDurationSeconds?: string;
  };
};
```

Validation requires at least one of `startPrice`/`startFdv` and at least one of `migrationPrice`/`migrationFdv`. If both members of either pair are provided, they must agree given `totalBase`; inconsistent pairs are rejected. The missing representation is derived during normalization. Amounts must be exactly representable at the specified asset decimals. Percentages are checked as exact basis-point values.

Intent validation returns `status: "valid"` with both the accepted intent and normalized values, or `status: "invalid"` with path-specific issues. Invalid input is never normalized or passed to the solver. These shared validation, solver, and verification statuses are defined in §20.5.

Normalization happens immediately after validation. It converts token quantities to atomic `bigint`, percentages to basis points, and prices/FDV to arbitrary-precision decimal values. The normalized form is the solver input; protocol compilation later quantizes into protocol-specific fixed-point and integer types.

```ts
type NormalizedMarketIntent = {
  assets: {
    base: AssetDefinition;
    quote: AssetDefinition;
  };
  baseDecimals: number;
  quoteDecimals: number;
  totalBaseAtomic: bigint;
  startPrice: Decimal;
  startFdv: Decimal;
  migrationPrice: Decimal;
  migrationFdv: Decimal;
  quoteToMigrationAtomic?: bigint;
  targetBaseDistributionBps?: bigint;
  launchProfile?: "deep" | "balanced" | "momentum";
  maxEarlyPriceImpactBps?: bigint;
  earlyBuyerAdvantageBps?: bigint;
  sniperResistance?: "low" | "medium" | "high";
  maxSegments: number;
  migration?: {
    creatorLockedBps?: bigint;
    partnerLockedBps?: bigint;
    unlockedBps?: bigint;
    lockDurationSeconds?: bigint;
  };
};
```

The MVP solver accepts 1–16 segments, corresponding to at most 16 public-builder curve entries and 17 sqrt-price boundaries including the start. The normalized default is three segments when no maximum is supplied. Do not use JavaScript `number` or `CurrencyAmount` for human economic prices or FDV.

---

## 7.2 Output

```ts
type SolverMetricSet = {
  quoteToMigration: CurrencyAmount;
  baseDistributed: CurrencyAmount;
  baseDistributedBps: bigint;
  migrationPrice: Decimal;
  migrationFdv: Decimal;
};

type SolvedMarketCandidate = {
  id: string;
  curve: DbcCurve;
  metrics: SolverMetricSet;
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  objectiveScore: Decimal;
  verificationStatus: VerificationStatus;
  explanations: SolverExplanation[];
};

type SolverResult = {
  status: SolverStatus;
  candidates: SolvedMarketCandidate[];
  warnings: SolverWarning[];
};
```

Return up to three candidates in deterministic rank order. Solver statuses are defined in §20.5. An `unsatisfied` result has no deployable candidates; `partial` candidates must explain which constraints remain unmet. `CurrencyAmount` represents token quantities in atomic units, `Decimal` represents human economic prices/FDV and the solver objective, and percentages are integer basis points (`10_000` = 100%). `verificationStatus` describes the strongest evidence actually completed and must not be inferred from a local structural check.

---

## 7.3 Curve segment

The domain curve stores encoded Q64.64 square-root price boundaries and unsigned protocol liquidity as `bigint`. Each segment is an interval between adjacent boundaries; the upper boundary and liquidity compile to one SDK curve entry shaped as `{ sqrtPrice: BN, liquidity: BN }`. The curve's migration quote threshold is a quote-token atomic amount encoded as `u64`.

```ts
type CurveSegment = {
  lowerSqrtPriceQ64x64: bigint;
  upperSqrtPriceQ64x64: bigint;
  liquidity: bigint;
};

type DbcCurve = {
  baseDecimals: number;
  quoteDecimals: number;
  startSqrtPriceQ64x64: bigint;
  migrationQuoteThresholdAtomic: bigint;
  segments: CurveSegment[];
};
```

Generated curves contain 1–16 contiguous segments, equivalent to 2–17 sqrt-price boundaries. Segment boundaries and liquidity must be positive, each upper boundary must exceed its lower boundary, and each segment must begin at the previous boundary. SDK-specific supported square-root price bounds and full configuration legality remain subject to the pinned SDK validator; structural validation alone does not prove a deployable config.

For user-facing explanations, derive each segment's price range, quote absorption, base distribution, and purpose from this protocol representation and the verified simulator output. Do not store those economic outputs as JavaScript `number` values.

The 20-entry legacy stored-config capacity is not the public-builder entry limit. Any future config-import path must model that legacy capacity separately.

---

## 7.4 Optimization formulation

Given `N <= maxSegments`, determine:

```text
P1 ... PN
L1 ... LN
```

subject to:

```text
P0 < P1 < P2 ... < PN
Li > 0
N <= protocol limit
```

Primary equations:

```text
Σ Li * (sqrt(Pi) - sqrt(Pi-1))
≈ target quote
```

and:

```text
Σ Li * (
    1 / sqrt(Pi-1)
    -
    1 / sqrt(Pi)
)
≈ target base distribution
```

Additional objectives may minimize:

```text
quote error
distribution error
migration-price error
early price impact
curve complexity
sniper profitability
```

---

## 7.5 Candidate objective function

```text
loss =
  w1 * normalized_quote_error
+ w2 * normalized_distribution_error
+ w3 * normalized_migration_price_error
+ w4 * early_slippage_penalty
+ w5 * attack_profitability_penalty
+ w6 * segment_complexity_penalty
```

The solver should return the best valid candidates, not only a single answer.

---

## 7.6 Solver strategy

MVP implementation:

1. Normalize user constraints.
2. Derive obvious exact values first.
3. Generate candidate price breakpoints.
4. Solve segment liquidity analytically where possible.
5. Optimize remaining free variables numerically.
6. Reject invalid DBC configs.
7. Run deterministic verification.
8. Rank candidates.
9. Run adversarial simulation against top candidates.
10. Return top 1–3.

Potential numerical approaches:

- constrained nonlinear optimization,
- differential evolution,
- CMA-ES,
- simulated annealing,
- grid + local refinement,
- gradient-based methods where differentiable.

For MVP, reliability and determinism are more important than theoretical elegance.

Keep economic optimization and DBC protocol math as separate modules (initially `src/economics` and `src/dbc-math` within the root package). Optimize over human price boundaries and liquidity weights, then quantize to protocol values and re-run the deterministic simulator and SDK validation. The quantized result is authoritative for output, constraints, explanations, and UI metrics.

---

# 8. Deterministic Simulator

The deterministic simulator must reproduce DBC behavior exactly for protocol outputs under the pinned SDK/program, subject only to a narrowly documented helper-specific exception of at most one atomic unit.

It should support:

```text
buy quote → base
sell base → quote
crossing multiple curve segments
fees
dynamic fees
migration threshold
surplus
post-migration accounting
```

The simulator must be tested against the pinned official Meteora SDK. Protocol outputs use exact parity by default; do not use percentage tolerances for atomic amounts, fees, or Q64.64 values.

---

## 8.1 Core simulator API

```ts
type SimulationClock = {
  slot: bigint;
  timestampSeconds: bigint;
};

type DynamicFeeState = {
  lastUpdateTimestamp: bigint;
  sqrtPriceReferenceQ64x64: bigint;
  volatilityAccumulator: bigint;
  volatilityReference: bigint;
};

type PoolSupplyState = {
  mode: "dynamic" | "fixed";
  totalBaseSupply: AssetAmount<"base">;
  baseDistributed: AssetAmount<"base">;
};

type PoolState = {
  curve: DbcCurve;
  fees: FeeConfiguration;
  migration: MigrationConfiguration;
  supply: PoolSupplyState;
  ledger: EconomicLedger;
  currentSqrtPriceQ64x64: bigint;
  clock: SimulationClock;
  activationPoint: bigint;
  activationType: FeeClock;
  migrationProgress: MigrationProgress;
  hasSwapped: boolean;
  dynamicFeeState?: DynamicFeeState;
};

type TradeFillStatus = "filled" | "partial";

type TradeFeeAmounts = {
  tradingFee: AssetAmount;
  protocolFee: AssetAmount;
  referralFee: AssetAmount;
};

type TradeResultBase<
  InputAsset extends AssetSide = AssetSide,
  OutputAsset extends AssetSide = AssetSide,
> = {
  status: TradeFillStatus;
  requestedInput: AssetAmount<InputAsset>;
  consumedInput: AssetAmount<InputAsset>;
  unfilledInput: AssetAmount<InputAsset>;
  output: AssetAmount<OutputAsset>;
  nextSqrtPriceQ64x64: bigint;
  fees: TradeFeeAmounts;
};

type BuyResult = TradeResultBase<"quote", "base"> & {
  direction: "buy";
};

type SellResult = TradeResultBase<"base", "quote"> & {
  direction: "sell";
};

type TradeResult = BuyResult | SellResult;

interface DbcSimulator {
  quoteBuy(inputQuote: bigint, state: PoolState): BuyResult;
  quoteSell(inputBase: bigint, state: PoolState): SellResult;

  executeBuy(inputQuote: bigint, state: PoolState): PoolState;
  executeSell(inputBase: bigint, state: PoolState): PoolState;

  getSpotPrice(state: PoolState): Decimal;
  getMigrationProgress(state: PoolState): Decimal;
}
```

`PoolState` is a pure in-memory DBC simulation snapshot. It contains no RPC, wallet, signer, or transaction state. Reserves and accounting values use `CurrencyAmount`; current and volatility sqrt prices remain encoded Q64.64 `bigint` values. `PoolSupplyState` records the resolved supply mode and base supply/distribution metrics; the exact accounting boundary for base distribution must be established by parity tests. The simulation clock carries both slot and Unix timestamp, while `activationPoint` and `activationType` preserve the selected config's scheduler clock. `migrationProgress` is a lifecycle state, separate from the continuous progress ratio returned by the simulator.

For trade results, `requestedInput` is the offered amount, `consumedInput` is the amount debited, `unfilledInput` is the unconsumed remainder, and `output` is what the trader receives after applicable fees. Each `AssetAmount` carries its base/quote identity and decimal scale. The fee fields mirror SDK-reported categories; do not assume they are disjoint or sum them without verifying the pinned implementation. `quoteBuy` and `quoteSell` are previews and do not mutate the supplied state; execution returns a new state only after the trade transition is parity-tested.

---

## 8.2 Deterministic outputs

For any proposed curve:

```text
Quote required per segment
Base distributed per segment
Average entry price per segment
Spot price trajectory
Migration quote
Migration price
Migration FDV
Effective fees
Post-migration allocation
```

---

# 9. Stochastic Simulation Engine

The deterministic engine answers:

> What does this configuration mathematically do?

The stochastic engine answers:

> What might happen when humans and bots interact with it?

---

## 9.1 Agent archetypes

MVP archetypes:

### Retail Buyer

```text
Buy size:
$50–$500

Entry:
distributed over time

Exit:
probabilistic
```

### Whale

```text
Buy size:
$5,000–$50,000

Behavior:
large one-shot entries
```

### Sniper

```text
Entry:
first possible block / earliest simulation tick

Goal:
maximize extraction from later demand
```

### Momentum Trader

```text
Buys after positive price momentum
```

### Profit Taker

```text
Sells after target gain
```

### Panic Seller

```text
Sells after drawdown threshold
```

### Random Trader

```text
Stochastic baseline participant
```

---

## 9.2 Simulation loop

Pseudo-flow:

```ts
for each simulation:
  initializePool()

  for each tick:
    agents.observe(state)
    actions = agents.decide(state)
    execute(actions)
    record(metrics)

  summarize()
```

---

## 9.3 Monte Carlo outputs

Example:

```text
10,000 simulations

Graduation frequency:
82.4%

Median quote accumulated:
$100,000

Median time / ticks to migration:
3h 14m equivalent

Median top-10 holder concentration:
34%

Median maximum drawdown:
27%

Median creator fees:
$1,842

Median sniper extraction:
$7,290
```

These outputs must be labeled as simulations, not predictions or guarantees.

The result contract in §20.1 is authoritative. Every run records engine and SDK versions; stochastic runs also record the random seed, requested/completed iteration counts, and archetype counts. Report distributions as statistics over completed runs and distinguish partial or failed runs from complete results. Do not interpret a percentile as a guarantee.

---

# 10. Adversarial Engine

The adversarial engine is one of the central demo features.

UI label:

# ATTACK MY MARKET

The user selects attacks or runs all.

---

## 10.1 MVP attack strategies

### Attack 1 — Opening Sniper

```text
Large buy immediately after launch
Wait for modeled retail demand
Exit partially or completely
```

Metrics:

```text
sniper profit
retail price disadvantage
drawdown after exit
fees paid
```

---

### Attack 2 — Whale Entry

```text
Single participant buys X% of migration quote
```

Metrics:

```text
price displacement
base acquired
average execution price
post-buy concentration
```

---

### Attack 3 — Pump and Dump

```text
large buy
induce momentum traders
sell into secondary demand
```

Metrics:

```text
attacker PnL
peak-to-trough drawdown
late-buyer loss
quote required for market recovery
```

---

### Attack 4 — Sell Cascade

```text
several profit takers / panic sellers exit consecutively
```

Metrics:

```text
drawdown
quote outflow
price recovery requirement
migration delay
```

---

### Attack 5 — Fee-Schedule Exploit

Search for trade timing around fee-decay transitions.

Metrics:

```text
best entry timestamp
fee saved
PnL improvement
```

Attack result contracts and their scenario-specific metric units are defined in §20.2. Each run must preserve its seed, iteration counts, and engine/SDK versions so the outcome can be reproduced. A failed run records a failure and must not be presented as a completed attack result.

---

## 10.2 Future attacks

- Sybil-wallet distribution
- Sandwich-like modeled pressure
- Strategic migration overshoot
- Repeated micro-buy manipulation
- Liquidity cliff exploitation
- Creator / insider inventory simulations
- Adversarial transfer-hook interactions

---

# 11. Economic Audit Engine

The audit engine converts simulation data into understandable findings.

It should behave like a static-analysis / risk-analysis tool for token-launch economics.

---

## 11.1 Audit categories

### Price Stability

```text
Early price sensitivity
Mid-curve depth
Late-stage sensitivity
```

### Concentration

```text
top holder concentration
top-10 concentration
capital concentration
```

### Early Advantage

```text
first 10% quote average price
vs
median buyer average price
```

### Sniper Exposure

```text
modeled attacker profitability
```

### Exit Liquidity Sensitivity

```text
price decline caused by modeled sell sizes
```

### Migration Fragility

```text
how dependent graduation is on late-stage capital
```

### Fee Shock

```text
economic discontinuities caused by fee schedule changes
```

### Surplus Behavior

```text
expected migration overshoot
distribution of surplus
```

### Post-Migration Liquidity

```text
locked %
vested %
immediately liquid %
```

---

## 11.2 Severity language

Avoid fake precision such as:

```text
Security score: 93/100
```

Prefer:

```text
LOW
MODERATE
HIGH
```

with exact supporting metrics.

An audit finding must include its category, severity, concise explanation, evidence references, typed metric values, and suggested remediations. Evidence must identify whether it came from deterministic, stochastic, adversarial, SDK-parity, or on-chain data. The canonical finding and evidence contracts are defined in §20.3. Severity is an explainable classification, not a composite score; retain the supporting measurements and their provenance.

Example:

```text
HIGH — Opening Sniper Exposure

A modeled $25,000 opening purchase followed by
baseline retail demand returned a median simulated
profit of 18.3% before fees across 5,000 runs.

Primary cause:
The first curve segment has low virtual liquidity.

Suggested mitigation:
Increase early-segment liquidity and/or retain
higher opening fees for longer.
```

---

# 12. Automatic Improvement Loop

After an audit, the user can choose:

```text
Optimize against these risks
```

Flow:

```text
current config
    ↓
attack results
    ↓
risk penalties
    ↓
optimizer
    ↓
new candidate config
    ↓
re-simulate
```

The system should show a diff.

Example:

```text
                    BEFORE      AFTER

Sniper median PnL    18.3%       5.1%
$10k price impact    31%         12%
Quote target error   0.4%        0.7%
Base distributed     25.1%       24.8%
Segments             3           4
```

This can become the strongest technical moment of the demo.

---

# 13. AI Layer

AI should be constrained to interpretation and explanation.

It should not be the source of financial mathematics.

---

## 13.1 AI responsibilities

The LLM can:

- parse natural-language market intent,
- map language to structured constraints,
- explain generated curves,
- explain audit findings,
- translate DBC jargon,
- suggest which parameter to adjust,
- generate human-readable deployment summaries.

---

## 13.2 Non-AI responsibilities

The LLM should never be authoritative for:

- curve calculations,
- swap calculations,
- fee calculations,
- migration thresholds,
- simulation outcomes,
- DBC validity,
- numerical optimization.

Those must be deterministic.

Architecture:

```text
User intent
    ↓
LLM
    ↓
Structured MarketIntent
    ↓
Validator
    ↓
Math / Optimizer
    ↓
DBC candidate
    ↓
Simulator
    ↓
Audit
    ↓
LLM explanation
```

---

# 14. Deployment Layer

Tymba should ultimately produce a real Meteora-compatible deployment.

---

## 14.1 Deployment stages

```text
1. Validate wallet
2. Validate network
3. Build DBC config
4. Preview transaction(s)
5. Create config / pool
6. Confirm signatures
7. Fetch on-chain state
8. Compare deployed values against compiled values
9. Save deployment record
```

Every simulation and deployment record should include the Tymba engine version and exact Meteora DBC SDK version so results remain reproducible after dependency updates.

The deployment record contract is defined in §20.4. Deployment is devnet-only for MVP and requires explicit user approval before signing or broadcast. Store public addresses, transaction signatures, version identifiers, timestamps, and verification results only; never store signer material or secrets. A local prepared record is not evidence of on-chain deployment, and a submitted transaction is not verified until fetched on-chain state has been compared with the compiled candidate.

---

## 14.2 Deployment safety

Before broadcasting:

```text
✓ configuration mathematically valid
✓ migration threshold reachable
✓ allocations sum correctly
✓ supply requirements valid
✓ fee config valid
✓ wallet balance sufficient
✓ transaction simulation succeeds
```

---

# 15. Transfer Hooks

Transfer hooks are an advanced extension, not MVP core.

Potential use:

```text
DBC swap
   ↓
Token-2022 transfer
   ↓
Custom hook program
   ↓
allow / reject / account
```

Possible launch-phase features:

- eligibility allowlists,
- participation accounting,
- gated transfers,
- launch-time behavioral restrictions.

Important:

Tymba must not claim vanilla DBC provides per-wallet ownership limits.

Any such feature must be explicitly described as custom on-chain logic.

Transfer hooks should be presented as:

```text
Advanced launch controls
```

rather than part of the basic curve compiler.

---

# 16. MVP Scope

The bounty MVP should be intentionally narrow.

## Must have

1. Structured intent form.
2. Optional natural-language intent input.
3. Inverse curve solver.
4. Legal Meteora DBC configuration output.
5. Deterministic DBC simulator.
6. Curve visualization.
7. At least five adversarial scenarios.
8. Economic audit report.
9. Before/after optimizer comparison.
10. Meteora devnet deployment.
11. One strong prebuilt demo configuration.
12. Shareable report URL or export.

---

## Nice to have

- Mainnet deployment.
- Public config auditing.
- Historical pool imports.
- Transfer-hook experiment.
- AI explanations.
- Saved workspaces.
- Multi-user teams.
- Public API.
- MCP server.

---

## Explicitly out of scope for MVP

- full launchpad ecosystem,
- token discovery feed,
- social layer,
- portfolio management,
- trading terminal,
- arbitrary prediction markets,
- full governance stack,
- generalized DeFi protocol builder.

---

# 17. Recommended Architecture

```text
                    Web Client
                       │
          ┌────────────┼────────────┐
          │            │            │
       Design       Simulate      Audit
          │            │            │
          └────────────┼────────────┘
                       │
                  API / Backend
                       │
       ┌───────────────┼─────────────────┐
       │               │                 │
 Intent Parser     Curve Solver      DBC Adapter
       │               │                 │
       │          Deterministic           │
       │           Simulator              │
       │               │                 │
       │         Monte Carlo Engine       │
       │               │                 │
       │       Adversarial Engine         │
       │               │                 │
       └───────────────┼─────────────────┘
                       │
                    Database
                       │
                       ▼
                 Meteora / Solana
```

---

# 18. Suggested Tech Stack

Given the product domain and Meteora ecosystem:

## Frontend

```text
tanstack
TypeScript
React
Tailwind
Recharts / lightweight custom SVG / Canvas
Solana wallet adapter
```

Avoid overengineering visualization initially.

---

## Backend

Option A:

```text
TypeScript / Node / NestJS / Fastify Adapter
```

Advantages:

- easy sharing with frontend,
- same number representations / schemas,
- straightforward Meteora SDK integration.

Option B:

```text
Rust simulation service
+
TypeScript application backend
```

Use only if simulation performance becomes a bottleneck.

For the bounty, TypeScript is likely enough.

---

## Database

```text
PostgreSQL
```

Useful entities:

```text
users
projects
market_intents
solver_runs
curve_candidates
simulation_runs
attack_runs
audit_reports
deployments
```

---

## Queue / parallel simulation

Initially:

```text
worker_threads
```

or:

```text
BullMQ + Redis
```

Only add distributed workers if Monte Carlo volume demands it.

---

# 19. Suggested Repository Structure

```text
tymba/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── domain/
│   │   ├── market-intent/
│   │   ├── curve/
│   │   ├── fees/
│   │   └── migration/
│   │
│   ├── dbc-math/
│   │   ├── pricing.ts
│   │   ├── segments.ts
│   │   ├── swaps.ts
│   │   └── migration.ts
│   │
│   ├── optimizer/
│   │   ├── constraints.ts
│   │   ├── objective.ts
│   │   ├── candidate-generator.ts
│   │   └── solve.ts
│   │
│   ├── simulator/
│   │   ├── deterministic/
│   │   ├── stochastic/
│   │   ├── agents/
│   │   └── metrics/
│   │
│   ├── adversarial/
│   │   ├── sniper.ts
│   │   ├── whale.ts
│   │   ├── pump-dump.ts
│   │   ├── sell-cascade.ts
│   │   └── fee-timing.ts
│   │
│   ├── audit/
│   │   ├── rules/
│   │   ├── severity.ts
│   │   └── report.ts
│   │
│   ├── meteora/
│   │   ├── sdk.ts
│   │   ├── config-builder.ts
│   │   ├── deploy.ts
│   │   └── fetch.ts
│   │
│   └── shared/
│
├── scripts/
│   ├── verify-math.ts
│   ├── compare-sdk.ts
│   └── seed-demo.ts
│
├── tests/
│   ├── dbc-math/
│   ├── optimizer/
│   ├── simulator/
│   └── integration/
│
└── spec.md
```

---

# 20. Core Domain Types

The external `MarketIntent` is defined only in §7.1, and curve types are defined only in §7.3. Do not redefine either contract here. `CurrencyAmount` stores an atomic integer plus its decimal scale. The following domain contracts use `bigint` for basis points, time intervals, and protocol-sized integer parameters; the SDK adapter performs any checked conversion to SDK-specific representations.

```ts
type CurrencyAmount = {
  raw: bigint;
  decimals: number;
};

type FeeClock = "slot" | "timestamp";
type FeeCollectionMode = "quote" | "output";

type BaseFeeSchedule =
  | { kind: "fixed"; feeBps: bigint }
  | {
      kind: "linear" | "exponential";
      startingFeeBps: bigint;
      endingFeeBps: bigint;
      periodCount: bigint;
      periodFrequency: bigint;
      clock: FeeClock;
    };

type DynamicFeeConfiguration = {
  binStepBps: bigint;
  filterPeriodSeconds: bigint;
  decayPeriodSeconds: bigint;
  reductionFactorBps: bigint;
  maxVolatilityAccumulator: bigint;
  variableFeeControl: bigint;
};

type FeeConfiguration = {
  base: BaseFeeSchedule;
  dynamic?: DynamicFeeConfiguration;
  collectFeeMode: FeeCollectionMode;
  creatorTradingFeeShareBps: bigint;
  migratedPool?: MigratedPoolFeeConfiguration;
};

type MigrationFeeConfiguration = {
  feeBps: bigint;
  creatorFeeShareBps: bigint;
};

type MigrationAllocationIntent = {
  creatorLockedBps: bigint;
  partnerLockedBps: bigint;
  unlockedBps: bigint;
  lockDurationSeconds?: bigint;
};

type LiquidityAllocation = {
  creator: {
    unlockedBps: bigint;
    permanentlyLockedBps: bigint;
    vestingBps: bigint;
  };
  partner: {
    unlockedBps: bigint;
    permanentlyLockedBps: bigint;
    vestingBps: bigint;
  };
};

type MigrationConfiguration = {
  destination: "damm-v2";
  fee?: MigrationFeeConfiguration;
  allocationIntent?: MigrationAllocationIntent;
  liquidityAllocation?: LiquidityAllocation;
  migratedPoolFee?: MigratedPoolFeeConfiguration;
};

type MigratedPoolFeeConfiguration = {
  feeBps: bigint;
  collectFeeMode: "quote" | "output" | "compounding";
  dynamicFeeEnabled: boolean;
  compoundingFeeBps?: bigint;
};

type MigrationProgress = "bonding" | "curve-complete" | "locked-vesting" | "migrated";

type SolverExplanation = {
  code: string;
  message: string;
  segmentIndex?: number;
};

type SolverWarningCode =
  | "constraint_conflict"
  | "target_not_met"
  | "protocol_limit"
  | "unsupported_configuration"
  | "allocation_mapping_unresolved"
  | "verification_pending";

type SolverWarning = {
  code: SolverWarningCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  path?: string;
  candidateId?: string;
  verificationStatus?: VerificationStatus;
};
```

`MigrationAllocationIntent` is the normalized three-part allocation in §7.1. `LiquidityAllocation` records the six creator/partner post-migration buckets described in §6.4. They are deliberately separate: the protocol-backed conversion between them has not been established and must not be guessed. BPS values, allocation sums, lock durations, and SDK-specific limits require runtime validation before compilation.

Solver outputs are defined in §7.2, and pool state and deterministic trade results are defined in §8.1. The simulation, attack, audit, and deployment contracts are defined in §§20.1–20.4. Do not use JavaScript `number` for monetary values, prices, percentages, PnL, or economic ratios in any domain contract. Use `Decimal` for human economic values, `CurrencyAmount`/asset-tagged amounts for token quantities, and `bigint` for atomic integers, basis points, counts, slots, and timestamps.

## 20.1 Simulation result contracts

```ts
type SimulationKind = "deterministic" | "stochastic";
type SimulationRunStatus = "completed" | "partial" | "failed";

type AgentArchetype =
  | "retail-buyer"
  | "whale"
  | "sniper"
  | "momentum-trader"
  | "profit-taker"
  | "panic-seller"
  | "random-trader";

type DistributionSummary<Value> = {
  median: Value;
  p95?: Value;
};

type SimulationRunMetadata = {
  id: string;
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds?: bigint;
};

type SimulationFailure = {
  code: string;
  message: string;
};

type DeterministicSimulationMetrics = {
  migrated: boolean;
  finalSpotPrice: Decimal;
  finalMigrationPrice?: Decimal;
  finalMigrationFdv?: Decimal;
  quoteAccumulated: AssetAmount<"quote">;
  baseDistributed: AssetAmount<"base">;
  baseDistributedBps: bigint;
  maximumPriceImpactBps: bigint;
  maximumDrawdownBps: bigint;
  feesGenerated: AssetAmountPair;
};

type DeterministicSimulationResult = SimulationRunMetadata & {
  kind: "deterministic";
  status: "completed" | "partial";
  initialState: PoolState;
  finalState: PoolState;
  trades: readonly TradeResult[];
  metrics: DeterministicSimulationMetrics;
  verificationStatus: VerificationStatus;
};

type AgentCounts = Record<AgentArchetype, bigint>;

type StochasticSimulationSummary = {
  graduationFrequencyBps: bigint;
  quoteAccumulated: DistributionSummary<AssetAmount<"quote">>;
  baseDistributed: DistributionSummary<AssetAmount<"base">>;
  timeToMigrationSeconds?: DistributionSummary<bigint>;
  maximumDrawdownBps: DistributionSummary<bigint>;
  topHolderConcentrationBps?: DistributionSummary<bigint>;
  topTenHolderConcentrationBps?: DistributionSummary<bigint>;
  creatorFees?: DistributionSummary<AssetAmountPair>;
  sniperExtractionQuote?: DistributionSummary<AssetAmount<"quote">>;
};

type StochasticSimulationResult = SimulationRunMetadata & {
  kind: "stochastic";
  status: "completed" | "partial";
  randomSeed: bigint;
  requestedIterations: bigint;
  completedIterations: bigint;
  agentCounts: AgentCounts;
  summary: StochasticSimulationSummary;
};

type FailedSimulationResult = SimulationRunMetadata & {
  kind: SimulationKind;
  status: "failed";
  failure: SimulationFailure;
};

type SimulationResult =
  | DeterministicSimulationResult
  | StochasticSimulationResult
  | FailedSimulationResult;
```

Amounts tagged `"quote"` or `"base"` are atomic token quantities with explicit decimals. Prices and FDV are human-unit `Decimal` values. Basis points use `10_000n` for 100%; time and iteration counts use `bigint`. Deterministic results preserve initial/final pool snapshots and trade outputs. Stochastic distribution fields summarize completed iterations; omitted metrics mean unavailable/not applicable, not zero.

## 20.2 Attack result contracts

```ts
type AttackScenario =
  | "opening-sniper"
  | "whale-entry"
  | "pump-and-dump"
  | "sell-cascade"
  | "fee-schedule-timing";

type AttackRunStatus = "completed" | "partial" | "failed";

type AttackRunMetadata = {
  id: string;
  randomSeed: bigint;
  requestedIterations: bigint;
  completedIterations: bigint;
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds?: bigint;
};

type AttackFailure = { code: string; message: string };

type OpeningSniperMetrics = {
  attackerPnlQuote: DistributionSummary<AssetAmount<"quote">>;
  lateBuyerPriceDisadvantageBps: DistributionSummary<bigint>;
  drawdownAfterExitBps: DistributionSummary<bigint>;
  feesPaid: DistributionSummary<AssetAmountPair>;
};

type WhaleEntryMetrics = {
  priceDisplacementBps: DistributionSummary<bigint>;
  baseAcquired: DistributionSummary<AssetAmount<"base">>;
  averageExecutionPrice: DistributionSummary<Decimal>;
  postBuyConcentrationBps: DistributionSummary<bigint>;
};

type PumpAndDumpMetrics = {
  attackerPnlQuote: DistributionSummary<AssetAmount<"quote">>;
  peakToTroughDrawdownBps: DistributionSummary<bigint>;
  lateBuyerLossBps: DistributionSummary<bigint>;
  recoveryQuoteRequired: DistributionSummary<AssetAmount<"quote">>;
  feesPaid: DistributionSummary<AssetAmountPair>;
};

type SellCascadeMetrics = {
  maximumDrawdownBps: DistributionSummary<bigint>;
  quoteOutflow: DistributionSummary<AssetAmount<"quote">>;
  recoveryQuoteRequired: DistributionSummary<AssetAmount<"quote">>;
  migrationDelaySeconds: DistributionSummary<bigint>;
};

type FeeScheduleTimingMetrics = {
  bestEntryClock: SimulationClock;
  feesSaved: DistributionSummary<AssetAmount>;
  pnlImprovementQuote: DistributionSummary<AssetAmount<"quote">>;
};

type CompletedAttackResult<Scenario extends AttackScenario, Metrics> =
  AttackRunMetadata & {
    scenario: Scenario;
    status: "completed" | "partial";
    metrics: Metrics;
  };

type FailedAttackResult = AttackRunMetadata & {
  scenario: AttackScenario;
  status: "failed";
  failure: AttackFailure;
};

type AttackResult =
  | CompletedAttackResult<"opening-sniper", OpeningSniperMetrics>
  | CompletedAttackResult<"whale-entry", WhaleEntryMetrics>
  | CompletedAttackResult<"pump-and-dump", PumpAndDumpMetrics>
  | CompletedAttackResult<"sell-cascade", SellCascadeMetrics>
  | CompletedAttackResult<"fee-schedule-timing", FeeScheduleTimingMetrics>
  | FailedAttackResult;
```

Quote/base quantities are asset-tagged atomic amounts. Prices are `Decimal`, percentages/concentration/drawdown are basis points, and durations/iteration counts use `bigint`. Attack metrics summarize the seeded runs; the scenario does not imply that its assumed participants or behavior represent real users.

## 20.3 Audit finding and evidence contracts

```ts
type AuditSeverity = "LOW" | "MODERATE" | "HIGH";

type AuditFindingCategory =
  | "price-stability"
  | "concentration"
  | "early-advantage"
  | "sniper-exposure"
  | "exit-liquidity-sensitivity"
  | "migration-fragility"
  | "fee-shock"
  | "surplus-behavior"
  | "post-migration-liquidity";

type AuditEvidenceSource =
  | "deterministic-simulation"
  | "stochastic-simulation"
  | "adversarial-simulation"
  | "sdk-parity"
  | "on-chain";

type AuditEvidenceValue =
  | { kind: "amount"; value: AssetAmount }
  | { kind: "basis-points"; value: bigint }
  | { kind: "decimal"; value: Decimal }
  | { kind: "duration-seconds"; value: bigint }
  | { kind: "count"; value: bigint };

type AuditEvidence = {
  source: AuditEvidenceSource;
  reference: string;
  metric: string;
  value: AuditEvidenceValue;
};

type AuditFinding = {
  id: string;
  ruleId: string;
  category: AuditFindingCategory;
  severity: AuditSeverity;
  title: string;
  summary: string;
  evidence: readonly [AuditEvidence, ...AuditEvidence[]];
  suggestedRemediations: readonly string[];
};
```

Each evidence reference must resolve to a retained run, parity case, or on-chain observation and identify the exact metric/unit. A finding must not claim stronger evidence than its source supports. Remediations are suggestions tied to controllable inputs and must state material trade-offs; findings are not guarantees or a single-number safety score.

## 20.4 Deployment record contracts

```ts
type DeploymentStatus =
  | "prepared"
  | "awaiting-user-approval"
  | "rejected"
  | "submitted"
  | "confirmed"
  | "verified"
  | "failed";

type DeploymentApproval = {
  status: "pending" | "approved" | "rejected";
  recordedAtSeconds?: bigint;
  approverAddress?: string;
};

type DeploymentVerificationStatus =
  | "not-started"
  | "pending"
  | "verified"
  | "mismatch"
  | "failed";

type DeploymentMismatch = {
  path: string;
  expected: string;
  actual: string;
};

type DeploymentVerification = {
  status: DeploymentVerificationStatus;
  checkedAtSlot?: bigint;
  mismatches: readonly DeploymentMismatch[];
};

type DeploymentRecord = {
  id: string;
  candidateId: string;
  network: "devnet";
  status: DeploymentStatus;
  approval: DeploymentApproval;
  configAddress?: string;
  poolAddress?: string;
  transactionSignatures: readonly string[];
  engineVersion: string;
  sdkVersion: string;
  preparedAtSeconds: bigint;
  submittedAtSeconds?: bigint;
  confirmedSlot?: bigint;
  verifiedAtSeconds?: bigint;
  verification: DeploymentVerification;
};
```

The status fields describe lifecycle evidence, not authorization logic: runtime validation must enforce legal transitions and require recorded explicit user approval before signing or broadcast. Only public chain identifiers and transaction data belong in this record; never include private keys, seed phrases, signer objects, or other signing material. `verified` requires fetched on-chain state and a completed comparison; mismatches remain explicit and must not be hidden by a successful transaction confirmation.

## 20.5 Shared validation, solver, and verification statuses

```ts
type ValidationStatus = "valid" | "invalid";

type SolverStatus = "satisfied" | "partial" | "unsatisfied";

type VerificationStatus =
  | "unverified"
  | "sdk-validated"
  | "sdk-parity-verified"
  | "on-chain-verified";
```

Validation status describes whether an input conforms to its domain schema and constraints. A valid intent result includes its normalized intent; a valid curve result includes the checked curve. An invalid result includes validation issues and must not contain a normalized intent or accepted curve.

Solver status describes economic constraint satisfaction, not validation or protocol evidence. `satisfied` means all requested constraints are met within their defined tolerances. `partial` means a candidate exists but one or more requested constraints remain unmet and must be identified. `unsatisfied` means no candidate can meet the solver's feasibility requirements; it has no deployable candidate.

Verification status records evidence actually completed for a candidate: `unverified` means no SDK validation or stronger check has completed; `sdk-validated` means the pinned SDK accepted the candidate; `sdk-parity-verified` means the applicable protocol outputs were compared against the pinned SDK under the parity policy in §3.5; and `on-chain-verified` means fetched chain state was compared against the candidate. Do not infer a stronger status from a weaker check. These statuses are distinct from the deployment lifecycle and verification statuses in §20.4 and do not by themselves authorize deployment.

Simulation and attack run statuses, audit severity, and deployment lifecycle statuses remain domain-specific because they describe different outcome axes; they must not be substituted for validation, solver, or verification status.

## 20.6 Configuration validation

`validateFeeConfiguration(input: unknown)` and `validateMigrationConfiguration(input: unknown)` accept normalized domain-shaped objects and return a `ConfigurationValidationResult<T>`. Monetary percentages and protocol parameters at this boundary are `bigint`; the external `MarketIntent` continues to accept decimal strings and is validated/normalized under §7.1. Unknown fields and invalid values produce path-specific issues; invalid configurations must not be compiled.

```ts
type ConfigurationValidationIssue = {
  path: string;
  code: string;
  message: string;
};

type ConfigurationValidationResult<Value> =
  | { status: "valid"; value: Value }
  | { status: "invalid"; issues: readonly ConfigurationValidationIssue[] };
```

The pure domain validators enforce supported units and domain-level ranges before compilation: base fees are 25–9,900 bps; scheduled periods fit `u16`, period frequency fits `u64`, and the accepted schedule is strictly declining; dynamic-fee bin step is 1 bp, filter period is shorter than decay period, reduction factor is at most 10,000 bps, and volatility/control values fit `u24`. SDK percentage inputs must be representable as whole percentages (basis points divisible by 100): creator trading-fee share and DAMM v2 liquidity buckets use 0–100%; migration fee uses 0–99%, with creator share 0–100% and zero when migration fee is zero. Migrated-pool fees are 10–1,000 bps; compounding mode requires a 1–10,000 bps compounding fee and other modes reject that field. Allocation intent must sum to 10,000 bps with at least 1,000 bps assigned to locked intent; six DAMM v2 liquidity buckets must sum to 10,000 bps. A supplied lock duration must be positive and no greater than two years.

These checks do not replace the pinned SDK's `validateConfigParameters` or establish protocol parity. In particular, the domain allocation shape does not include vesting schedules, so it cannot prove that at least 10% remains locked one day after migration. The SDK adapter must validate the complete schedule with `validateMinimumLockedLiquidity` before any configuration is accepted for compilation or deployment.

---

# 21. Verification Strategy

The mathematical engine must be aggressively verified.

## 21.1 Unit tests

For each segment:

```text
known P0
known P1
known L

verify:
quote required
base distributed
reverse calculation
```

---

## 21.2 Property tests

Examples:

```text
Increasing L should reduce price movement
for fixed quote input.
```

```text
Buy followed by equivalent sell,
ignoring fees and rounding,
should approximately restore state.
```

```text
Quote required across multiple segments
should equal sum of segment quote requirements.
```

---

## 21.3 SDK parity tests

For many generated configurations:

```text
our quote
vs
Meteora SDK quote
```

Require exact equality for encoded fields, atomic amounts, fees, and migration outputs. If a particular SDK helper uses an approximation that makes exact parity impossible, isolate that helper and document a maximum one-atomic-unit tolerance for that helper only. Human-readable display values use formatting tests rather than economic tolerances.

This is essential.

---

## 21.4 On-chain devnet parity

Generate real test pools.

Compare:

```text
predicted state
vs
actual state after trades
```

This should become part of the demo credibility.

---

# 22. Demo Scenario

The bounty demo should be choreographed.

The entire value proposition should be understandable in roughly 60–90 seconds.

---

## Scene 1 — Intent

Landing page:

# What should your market do?

Enter:

> I have 1B tokens. Start around $200k FDV, raise roughly $150k, graduate near $2M, distribute around 25% before graduation, and make the opening difficult to snipe.

Press:

# COMPILE

---

## Scene 2 — Compiler

Animated pipeline:

```text
Intent
  ↓
Constraints
  ↓
DBC Solver
  ↓
3 valid curve candidates
```

Select recommended candidate.

Show:

```text
Capital target          $150,000
Distribution            24.8%
Migration FDV           $1.96M
Segments                3
```

---

## Scene 3 — Explanation

Visual curve animates.

Click each segment.

```text
Phase 1 — Discovery
Phase 2 — Distribution
Phase 3 — Graduation
```

Each explains:

- price range,
- quote absorbed,
- token distributed,
- why liquidity was chosen.

---

## Scene 4 — Simulate

Press:

# SIMULATE 10,000 MARKETS

Display:

```text
Graduation frequency
Median max drawdown
Median top-10 concentration
Median creator fees
Median time / ticks to migration
```

---

## Scene 5 — Attack

Press:

# ATTACK MY MARKET

Run:

```text
Opening Sniper
```

Animation:

```text
sniper buys
    ↓
retail arrives
    ↓
sniper exits
    ↓
price collapses
```

Result:

```text
Sniper median PnL: +18.3%
Late buyer disadvantage: 22.1%
Max drawdown: 38%
```

Show:

```text
HIGH RISK
```

---

## Scene 6 — Optimize

Press:

# HARDEN MARKET

Solver updates:

```text
early liquidity ↑
opening fee duration ↑
segment boundaries modified
```

Run attack again:

```text
Sniper median PnL: +5.1%
Late buyer disadvantage: 8.4%
Max drawdown: 21%
```

Show side-by-side diff.

This is the "wow" moment.

---

## Scene 7 — Deploy

Press:

# DEPLOY TO METEORA

Wallet signs.

Show:

```text
✓ Config created
✓ Pool created
✓ On-chain values verified
```

Then open live pool / transaction.

End with:

> **Tymba — Design. Attack. Deploy.**

---

# 23. Demo Data

Prepare one deterministic demo profile so results do not depend on randomness during judging.

Example:

```text
Supply:
1,000,000,000

Start FDV:
$200,000

Migration FDV:
~$2,000,000

Quote target:
$150,000

Target curve distribution:
25%

Launch profile:
Balanced

Sniper resistance:
High
```

Store the random seed used for Monte Carlo demo runs.

---

# 24. Product Language

Use normal English.

Prefer:

```text
Capital needed before graduation
```

over:

```text
Migration quote threshold
```

Prefer:

```text
How quickly should price move?
```

over:

```text
Virtual liquidity density
```

Prefer:

```text
Opening sniper protection
```

over:

```text
Exponential fee scheduler parameters
```

Advanced users can toggle:

```text
Show DBC parameters
```

---

# 25. Key UX Principle

Every low-level parameter should answer:

> What does this change economically?

Example advanced tooltip:

```text
Virtual Liquidity

Higher liquidity means buyers need more quote
capital to move price through this range.

Economic effect:
- lower slippage
- slower price discovery
- more capital absorption
```

---

# 26. Economic Claims We Must Avoid

Never claim:

```text
"Whales cannot own more than 5%."
```

unless separate on-chain enforcement exists.

Instead:

```text
"The modeled configuration reduces the advantage
of large opening purchases."
```

Never claim:

```text
"Guaranteed to raise $100k."
```

Instead:

```text
"The curve requires approximately $100k of net
quote inflow to reach migration under the configured path."
```

Never claim:

```text
"Safe from snipers."
```

Instead:

```text
"Opening-sniper profitability was materially lower
under the tested scenarios."
```

Simulation is evidence, not certainty.

---

# 27. Competitive Positioning

Tymba should deliberately differentiate from:

### Launchpads

They answer:

> How do I launch?

Tymba answers:

> What should my launch economics be?

---

### Visual curve designers

They answer:

> What does this manually selected curve look like?

Tymba answers:

> Which curve best satisfies my economic constraints?

---

### DBC analytics dashboards

They answer:

> What is happening to this market?

Tymba answers:

> How should this market be designed before it goes live?

---

### AI tokenomics tools

They answer:

> What tokenomics sound reasonable?

Tymba answers:

> Which legal DBC configuration mathematically produces the requested behavior, and how does it perform under simulation?

---

# 28. Core Differentiator

The clearest statement of differentiation:

> **Tymba is an inverse compiler for Meteora DBC.**

Traditional flow:

```text
DBC parameters
      ↓
market behavior
```

Tymba:

```text
desired market behavior
      ↓
mathematical constraints
      ↓
inverse solver
      ↓
valid DBC parameters
```

Then:

```text
DBC parameters
      ↓
adversarial simulation
      ↓
economic audit
      ↓
deployment
```

---

# 29. Possible Future Product Modes

## Design Mode

Create new DBC markets.

## Audit Mode

Paste or import an existing DBC config and inspect it.

## Compare Mode

Compare multiple DBC configs.

## Agent Mode

Expose:

```text
compile_market
simulate_market
attack_market
audit_market
deploy_market
```

through an API or MCP server.

## Marketplace Mode

Publish reusable verified launch strategies.

Example:

```text
Broad Distribution v2
High Momentum v1
Low Volatility v3
Anti-Sniper v4
```

---

# 30. Implementation Order

Build from the math upward, not UI downward.

## Phase 1 — DBC Math

Implement:

```text
price representation
segment quote math
segment base math
multi-segment buy
multi-segment sell
migration calculation
fees
```

Do not proceed until parity-tested.

---

## Phase 2 — Deterministic Simulator

Implement a complete in-memory pool state.

Run scripted trades.

Verify against Meteora SDK / devnet.

---

## Phase 3 — Inverse Solver

Start with simple constraints:

```text
start price
migration price
quote target
base distribution target
3 segments
```

Then expand.

---

## Phase 4 — Adversarial Simulation

Implement the five MVP attack strategies.

---

## Phase 5 — Audit Engine

Convert metrics into findings and suggested remediations.

---

## Phase 6 — UI

Build:

```text
Describe
Compile
Curve
Simulate
Attack
Audit
Deploy
```

---

## Phase 7 — Meteora Deployment

Create actual devnet config / pool and verify values.

---

## Phase 8 — AI Interpretation

Add natural-language intent only after deterministic systems work.

---

# 31. First Engineering Milestone

The first meaningful milestone should be a CLI, not a web interface.

Example:

```bash
pnpm Tymba compile example.json
```

Input:

```json
{
  "assets": {
    "base": {
      "symbol": "MKT",
      "decimals": 9
    },
    "quote": {
      "symbol": "USDC",
      "decimals": 6
    }
  },
  "supply": {
    "totalBase": "1000000000"
  },
  "pricing": {
    "startFdv": "200000",
    "migrationFdv": "2000000"
  },
  "targets": {
    "quoteToMigration": "150000",
    "baseDistributionPct": "25"
  },
  "preferences": {
    "launchProfile": "balanced",
    "sniperResistance": "high"
  },
  "solver": {
    "maxSegments": 3
  }
}
```

Output:

```text
SATISFIABLE

Curve:

1. $0.00020 → $0.00035
   Quote: $11,800
   Base: 60,000,000

2. $0.00035 → $0.00080
   Quote: $48,600
   Base: 110,000,000

3. $0.00080 → $0.00200
   Quote: $89,600
   Base: 78,000,000

Total quote:
$150,000

Base distributed:
248,000,000

Distribution:
24.8%

Migration FDV:
$2,000,000
```

Then:

```bash
pnpm Tymba attack example.json --scenario sniper
```

This establishes the actual product before frontend work begins.

---

# 32. Success Criteria for the Bounty

The project succeeds if a judge can understand the following within one minute:

1. Meteora DBC is powerful but low-level.
2. Tymba lets users specify economic outcomes instead of protocol parameters.
3. The system mathematically solves for a legal DBC configuration.
4. It simulates real market behavior.
5. It actively attacks the market configuration.
6. It identifies economic weaknesses.
7. It can automatically improve the configuration.
8. It deploys the result to Meteora.

The submission should make DBC itself look more powerful.

That alignment matters.

---

# 33. Suggested Pitch

> Meteora lets you program how a token market forms, but today you still have to think in curve points, liquidity values, fee schedules, and migration parameters.
>
> Tymba is an inverse compiler for DBC.
>
> Tell it the market behavior you want — how much capital to absorb, how much supply to distribute, where to graduate, and how sensitive the launch should be.
>
> Tymba solves for a valid DBC configuration, runs thousands of simulations, attacks it with modeled whales and snipers, explains the economic risks, and lets you harden the design before deploying it on Meteora.
>
> **Design. Attack. Deploy.**

---

# 34. Open Technical Questions

These should be resolved during implementation:

1. Exact local-to-SDK price/liquidity encoding and rounding parity.
2. Integer precision and rounding behavior.
3. Legacy stored curve-entry interpretation and segment limits for any future import path.
4. Exact fixed-vs-dynamic supply constraints.
5. Dynamic-fee state evolution.
6. Fee scheduler timestamp / slot semantics.
7. Migration overshoot behavior.
8. Devnet support parity.
9. Token-2022 constraints.
10. Transfer-hook behavior during buys, sells, and migration.
11. Exact post-migration liquidity-accounting semantics.
12. Which parameters are immutable after config creation.
13. Whether generated configs can be reused across multiple launches.
14. Which protocol fees / fee splits are fixed vs configurable.
15. Current Meteora SDK helpers available for curve construction and simulation.

Do not rely on assumptions for these. Validate against the current SDK/program before production deployment.

---

# 35. Reference Concepts

Official Meteora concepts relevant to this specification:

- Dynamic Bonding Curve
- Universal curve
- Curve segments / points
- Virtual liquidity
- Quote reserve
- Migration quote threshold
- DAMM v2 migration
- Fee scheduler
- Dynamic fees
- Surplus
- Dynamic / fixed token supply
- Token-2022
- Transfer hooks
- Partner / creator liquidity allocation

See [`PROTOCOL_NOTES.md`](./PROTOCOL_NOTES.md) for the current SDK pin, official source links, verified protocol facts, and open parity questions. That note is evidence and a planning aid; the deployed program and pinned SDK remain authoritative.

Recommended implementation rule:

> When this document conflicts with the currently deployed Meteora program or SDK, the program/SDK is authoritative and this specification must be updated.

---

# 36. Final Product Principle

Tymba should not try to make Web3 terminology easier.

It should make most of that terminology unnecessary.

The user should think:

> "This is how I want my market to behave."

The system should handle:

> "This is how Meteora DBC must be configured to approximate that behavior."

And before real money touches the market, the system should answer:

> "Here is how that design behaves when we try to break it."

That is the product.
