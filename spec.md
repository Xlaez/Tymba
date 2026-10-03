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

The first Phase 7 web slice provides the optional natural-language input as an explicitly uninterpreted design note. It retains the note with reviewed input but requires users to enter its economic goals in the structured form. Automatic LLM interpretation remains the later AI implementation stage in §30; this input-only slice must not imply parsing or enforcement of prose.

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

For the MVP allocation ledger, the amount being divided is distributable DAMM liquidity in protocol `u128` liquidity units, not base- or quote-token atomic amounts. Match the DBC program's allocation order and rounding: independently floor partner permanently locked, partner vesting, partner unlocked, creator permanently locked, and creator vesting shares; assign all remaining liquidity units to creator unlocked. The program stores its percentage inputs as integer fields, and the pinned SDK validator checks that all six shares sum to 100%; Tymba accepts only whole percentages. Do not infer per-position token deposits from these six liquidity shares; those remain part of DAMM migration math and require separate SDK/program parity.

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

Validation requires at least one of `startPrice`/`startFdv` and at least one of `migrationPrice`/`migrationFdv`. If both members of either pair are provided, they must agree given `totalBase`; inconsistent pairs are rejected. The missing representation is derived during normalization. The resolved migration price must be strictly greater than the resolved start price because the DBC curve progresses upward; equal or descending prices are incompatible constraints. Amounts must be exactly representable at the specified asset decimals. Percentages are checked as exact basis-point values.

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

The solver combines this normalized economic intent with optional typed fee and migration configuration inputs:

```ts
type NormalizedSolverInput = {
  market: NormalizedMarketIntent;
  fees?: FeeConfiguration;
  migrationConfiguration?: MigrationConfiguration;
};
```

Fee and migration configuration inputs use the domain types and are validated before they are included. If either is omitted, normalization preserves that omission; it must not silently synthesize a fee or allocation policy. The `MarketIntent.migration` percentages are economic allocation intent, not a six-bucket DAMM v2 allocation, and must not be mapped automatically while that mapping remains unresolved. JSON adapters represent protocol-sized integer configuration values as decimal strings before converting them to domain `bigint` values.

The MVP solver accepts 1–16 segments, corresponding to at most 16 public-builder curve entries and 17 sqrt-price boundaries including the start. The normalized default is three segments when no maximum is supplied. Do not use JavaScript `number` or `CurrencyAmount` for human economic prices or FDV.

Initial candidate generation uses a fixed three-segment count. When `maxSegments` is one or two, the initial count is reduced to that limit; otherwise it remains three. The initial search does not increase the segment count automatically.

The initial price grid is linearly spaced in human price between the exact normalized start and migration prices. Interior boundaries use 512-significant-digit decimal arithmetic with half-up rounding; both endpoints remain unchanged. If an interior point cannot remain strictly distinct at that precision, reject the grid instead of emitting duplicate or descending prices. These economic boundaries are only search seeds; protocol quantization and validation happen before simulation.

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

Return up to three candidates in deterministic rank order, with lower objective score first and candidate id as the tie-breaker. A candidate without at least `sdk-validated` evidence is excluded from the ranked deployable list. Solver statuses are defined in §20.5. An `unsatisfied` result has no deployable candidates; `partial` candidates must explain which constraints remain unmet. `CurrencyAmount` represents token quantities in atomic units, `Decimal` represents human economic prices/FDV and the solver objective, and percentages are integer basis points (`10_000` = 100%). `verificationStatus` describes the strongest evidence actually completed and must not be inferred from a local structural check.

Each candidate includes a per-segment liquidity explanation with the price band, protocol liquidity, locally calculated quote absorption and base distribution, and each segment's share of the curve totals. It identifies whether quote-fit and distribution-fit terms are weighted in the objective. These measured consequences explain the allocation trade-off; they do not claim the optimizer found a global optimum or that unmeasured attack behavior is safe.

The status reducer considers only candidates that already pass hard feasibility and protocol validation. No feasible candidates means `unsatisfied`; any feasible candidate meeting all requested constraints within their defined tolerances means `satisfied`; otherwise, feasible candidates with at least one unmet requested constraint mean `partial`. Verification evidence is reported separately and does not change economic constraint status.

A target conflict warning states the requested economic value, the candidate's measured value, the signed difference, and whether the candidate is above or below target. It also carries a structured alternative that can be applied to the corresponding intent field. Such an alternative is a measurable revised goal, not a promise that a later compile will reproduce the same candidate.

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

Before simulation, candidate validation checks positive u128 liquidity, the 1–16 public-builder segment limit and user maximum, exact N+1 boundary count, strictly increasing human and Q64.64 prices, positive u64 migration threshold, and that calculated base distribution does not exceed the positive u64 total supply. The quote threshold must not exceed the curve's locally calculated quote capacity. These are necessary local candidate checks, not sufficient Meteora config validation or a substitute for the pinned SDK's fixed/dynamic supply validator; the accounting boundary for supply remains subject to the verification limits in `PROTOCOL_NOTES.md`.

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

Objective weights are explicit `Decimal` inputs, must be non-negative, and must sum exactly to one. Tymba does not silently assign weights. A positively weighted term requires its measurement; a zero-weight term may be omitted. The objective score is the weighted sum, and the per-term penalties, weights, contributions, raw measurements, and evidence references are retained for explanation and reproducibility.

Normalize the terms as follows:

- Quote error: `abs(achievedQuoteAtomic - targetQuoteAtomic) / targetQuoteAtomic`; the target must be positive.
- Distribution error: `abs(achievedBps - targetBps) / 10_000`.
- Migration-price error: `abs(achievedPrice - targetPrice) / targetPrice`; the target must be positive.
- Early price-impact penalty: measure a single deterministic buy against the candidate's initial state using an explicitly supplied positive quote-atomic probe and retain the deterministic simulation id. If an impact limit is supplied, use `max(achievedImpactBps - limitBps, 0) / 10_000`; otherwise use `achievedImpactBps / 10_000`. There is no implicit probe-size default.
- Attack-profitability penalty: `max(attackerProfitQuoteAtomic, 0) / attackerCapitalQuoteAtomic`; capital must be positive. A positively weighted attack term requires an identified modeled attack result. An unrun attack is not treated as zero exposure.
- Segment-complexity penalty: `segmentCount / maxSegments`.

All arithmetic uses `Decimal` or `bigint`; only bounded segment counts use JavaScript `number`. When a target or metric is unavailable, its weight must be zero until a measurement exists. In particular, the Phase 4 objective may use attack exposure only when a deterministic or adversarial run supplies attacker PnL and capital; stochastic/adversarial scenarios are otherwise implemented in Phase 5.

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

The initial remaining-variable optimizer is deterministic bounded coordinate search over arbitrary-precision decimal values. It visits variables in declaration order and tests the negative then positive direction from the same point, accepts only strict objective improvements, and halves its normalized step fraction after a pass with no improvement. Defaults are a 0.25 initial fraction, a 0.0001 minimum fraction, and 256 passes. It uses no randomness; identical bounds, initial values, objective, and options must produce identical results.

For fixed Q64.64 boundaries and a per-segment atomic target, invert the linear liquidity equations analytically: quote liquidity is estimated from `targetQuoteAtomic * 2^128 / (upperSqrt - lowerSqrt)`, and base liquidity from `targetBaseAtomic * lowerSqrt * upperSqrt / (upperSqrt - lowerSqrt)`. Evaluate the floor and ceiling estimates within positive u128 liquidity bounds using the existing forward formulas (quote rounds up; distributed base rounds down). Choose the value with the smallest absolute atomic error, breaking ties toward lower liquidity, and report the achieved amount and residual. This is a segment-level analytic solve, not proof that combined market targets are jointly feasible or that the resulting curve passes protocol validation.

The current curve-solver draft uses the initial linear price grid and deterministic atomic target allocations. With both quote and distribution targets, it derives pairwise quote allocations from the interval base-per-quote ratios and evaluates a bounded deterministic set of neighboring atomic splits. It solves each segment's liquidity analytically, applies local curve guardrails, evaluates the explicitly weighted objective, and returns candidates with `verificationStatus: "unverified"`. This is a curve-generation stage only: it does not synthesize fee or migration configuration, and no candidate is deployable until pinned-SDK validation and deterministic simulator verification succeed.

Every locally valid solver candidate is run through the deterministic simulator before it is returned. The caller must explicitly provide validated fees, migration configuration, supply mode, simulation clock, activation point/type, and initial dynamic-fee state when dynamic fees are enabled. The verifier builds a fresh pre-launch state with the market's full base supply in the pool reserve, zero quote reserve, and zero fee/migration ledgers; finds the minimum quote input that reaches the terminal curve price under those settings; and runs that trade. It checks curve completion, final Q64.64 price, accumulated quote, base distributed, and distribution basis points against the candidate's locally computed curve values. Returned economic metrics are taken from this simulation. Simulator execution is reproducibility evidence, not SDK validation or protocol parity; `verificationStatus` remains `unverified` until stronger protocol evidence exists.

The pinned Meteora DBC SDK `validateCurve` validator also runs on each generated curve. Tymba converts each segment's upper Q64.64 boundary and liquidity to SDK BN values without changing the integers, supplies the candidate start boundary, and rejects both a false validator result and thrown validation errors. The candidate records the pinned SDK version and curve-entry count. This validates the curve array only; it does not validate complete config parameters, token-supply mode, migration/vesting configuration, or DAMM allocations, and it does not promote the candidate's `verificationStatus`. Full-config acceptance remains a separate compiler gate.

Each result carries a JSON-safe solver run record: normalized input, engine/algorithm/SDK versions, solver and simulation configuration, explicit objective weights, objective measurements and evidence, output metrics, issues, and warnings. Decimal and atomic values are strings. The solver is deterministic and consumes no randomness, so `randomSeed` is `null` with an explicit not-applicable policy; do not invent or imply a seed. Run records contain no generated timestamps or random identifiers; identical normalized inputs and configuration must produce identical run records.

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

type MigrationSettlement = {
  protocolLiquidityFee: AssetAmountPair;
  dammLiquidity: AssetAmountPair;
  leftoverBase: AssetAmount<"base">;
  liquidityUnits: bigint;
};

type MigrationExecutionResult = {
  state: PoolState;
  liquidityAllocation: {
    distributableLiquidity: bigint;
    creator: { unlocked: bigint; permanentlyLocked: bigint; vesting: bigint };
    partner: { unlocked: bigint; permanentlyLocked: bigint; vesting: bigint };
  };
  verificationStatus: VerificationStatus;
};

type PoolEconomicSnapshot = {
  poolReserves: AssetAmountPair;
  baseDistributed: AssetAmount<"base">;
  feesGenerated: AssetAmountPair;
  spotPrice: Decimal;
  migrationProgressBps: bigint;
  migrationProgress: MigrationProgress;
};

type TradeMetrics = {
  spotPriceBefore: Decimal;
  spotPriceAfter: Decimal;
  priceImpactBps: bigint;
  migrationProgressBeforeBps: bigint;
  migrationProgressAfterBps: bigint;
  poolReservesAfter: AssetAmountPair;
};

type DeterministicTradeInput = {
  direction: "buy" | "sell";
  inputAtomic: bigint;
  clock?: SimulationClock;
};

type DeterministicSimulationInput = {
  id: string;
  initialState: PoolState;
  trades: readonly DeterministicTradeInput[];
  migrationSettlement?: MigrationSettlement;
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
  metrics: TradeMetrics;
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
  executeMigration(state: PoolState, settlement: MigrationSettlement): MigrationExecutionResult;

  getSpotPrice(state: PoolState): Decimal;
  getMigrationProgress(state: PoolState): Decimal;
  getPoolEconomicSnapshot(state: PoolState): PoolEconomicSnapshot;
  runDeterministicSimulation(
    input: DeterministicSimulationInput,
  ): DeterministicSimulationResult;
}
```

`MigrationSettlement` supplies the protocol-liquidity fee, DAMM v2 base/quote deposits, fixed-supply leftover base, and migration liquidity units for the transition. The simulator checks exact asset-scale and reserve conservation, computes the configured migration fee from the documented threshold formula, and allocates the supplied liquidity units across the six configured buckets. Until protocol fee and DAMM deposit rounding have exact SDK/program parity, `executeMigration` returns `verificationStatus: "unverified"`; caller-supplied settlement values are modeled inputs, not protocol guarantees.

Each trade quote includes decimal spot prices before/after execution, absolute price impact in basis points, migration progress before/after, and projected post-trade reserves. `getMigrationProgress` returns a ratio from 0 to 1. A deterministic run requires an explicit stable id, initial state, ordered trade inputs, and optional per-trade clocks; it uses no wall-clock values or random seed. Run `quoteAccumulated` is the initial quote reserve plus net quote-reserve changes across the scripted trades, retained as a run metric even if migration later moves that reserve into DAMM v2.

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

The MVP archetypes are transparent rule-based models, not behavior learned from historical users. Each configured agent has an explicit identifier, starting quote/base wallet balances, and base-token cost basis. Buy sizes and wallet amounts are atomic `bigint` values; probabilities, allocation shares, and gain/drawdown thresholds are basis-point `bigint` values; tick counts and time intervals are also explicit integers. Every archetype parameter that changes economic behavior is required rather than silently defaulted.

- Retail buyers draw a configured per-tick buy probability, sample a quote size from an explicit inclusive range, and independently draw an exit probability while holding base tokens.
- Whales make one configured quote-sized purchase at an explicit tick.
- Snipers buy on the first tick, then exit at most once after both the configured minimum hold and cumulative retail-buyer base purchases reach their explicit thresholds. They exit the configured position share; neither demand nor a profitable exit is assumed.
- Momentum traders compare the current observed spot price with the preceding tick, buy when the configured increase threshold is met, and stop at an explicit purchase count.
- Profit takers enter at an explicit tick and quote size, then sell a configured position share after the configured gain threshold.
- Panic sellers enter at an explicit tick and quote size, then sell a configured position share after the configured drawdown from their observed peak.
- Random traders select buy, sell, or wait from explicit probabilities and sample buys from an explicit quote-size range; buy and sell probabilities must sum to no more than 100%.

The simulator maintains per-agent wallet balances and average quote cost basis from actual consumed inputs and delivered outputs. An agent cannot spend beyond its quote balance or sell more base than it owns. Starting agent base balances cannot exceed the pool's already-distributed base supply. These simplified strategies and their configured assumptions must accompany every report; they are not claims about actual participant behavior.

Scenario configuration explicitly supplies the initial pool candidate, random seed, tick count, slot and timestamp increments, execution-order policy, per-archetype counts, and one complete behavior/funding template for every nonzero count. The template is copied to each generated agent with a deterministic unique ID; callers needing heterogeneous agents can provide their individually configured agents directly. The synchronous in-memory MVP population is capped at 10,000 agents as a resource guard. No tick duration, trade size, agent count, or execution policy is silently selected.

---

## 9.2 Simulation loop

Pseudo-flow:

```ts
for each simulation:
  initializePool()

  for each tick:
    advanceSlotAndTimestamp()
    observation = snapshot(state)
    actions = agents.decide(observation)
    orderActions(explicitlyConfiguredOrSeededRandomOrder)
    executeSequentially(actions)
    record(observation, actions, executions, metrics)

  summarize()
```

All agents observe the same pre-execution pool snapshot for a tick. Observations include cumulative base purchased by each archetype, and portfolios include successful buy/sell counts. Their actions are collected before any trade executes. The execution-order policy is an explicit simulation input: preserve configured agent order or shuffle with the run's recorded seed. Trades then execute sequentially and every observation, decision, execution, rejection, and agent failure is retained in the run trace. Both slot and timestamp advance by explicit positive increments; no wall-clock time or hidden ordering default is used. A run with an agent implementation failure is marked partial, while an expected rejected trade remains recorded without hiding the rest of the modeled run.

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

P95 early-buyer price advantage:
12% (measured in 1,000 completed runs)

Median maximum drawdown:
27%

Median creator fees:
$1,842

Median sniper extraction:
$7,290
```

These outputs must be labeled as simulations, not predictions or guarantees.

The result contract in §20.1 is authoritative. Every run records engine and SDK versions; stochastic runs also record the random seed, requested/completed iteration counts, and archetype counts. Report distributions as statistics over completed runs and distinguish partial or failed runs from complete results. Do not interpret a percentile as a guarantee.

The Monte Carlo runner derives one unsigned 64-bit iteration seed per run from the explicitly supplied master seed using the versioned `splitmix64-v1` generator. It retains each iteration seed, status, completed tick count, and failure detail. Summary statistics exclude partial and failed iterations; if none complete, return a failed result without fabricated zero-valued statistics. Graduation frequency is calculated over completed iterations. Time-to-migration is conditional on completed iterations that reached the migration threshold. Quote accumulation is the signed change in the pool's quote reserve; holder concentration is computed among tracked agent balances, not inferred across unmodeled wallets. Fee summaries use their explicit base/quote components.

Graduation means that the modeled DBC curve reached its configured quote threshold; it does not imply DAMM v2 settlement or SDK/on-chain migration verification. Maximum drawdown is the largest observed peak-to-later-price decline over executed trades, maximum price impact is the largest per-trade impact, and fee distributions come from explicit ledger deltas. Top-holder and top-ten concentration use the total base balances held by configured agents for that completed run; they do not claim concentration across wallets absent from the scenario.

Early-participant price advantage is measured per completed iteration from event-order buy fills. It compares the exact first 10% of executed quote buy input with the nearest-rank median of per-buyer average entry prices; if the 10% boundary falls inside a trade, the simulator re-quotes that exact partial input against the pre-trade pool state. The stored p05/median/p95 values are paired records sorted by advantage, and the sample-size field counts completed iterations with enough quote and buyer data. The reported advantage is non-negative; accompanying prices preserve the actual comparison when early buyers did not pay less.

Percentiles use the nearest-rank rule with no interpolation: rank = `ceil(sampleSize * percentileBps / 10_000)`. The p50 is therefore the lower middle observation for an even-sized sample. Fee-pair quantiles retain the joint observation and use base-fee atomic amount, then quote-fee atomic amount, as the deterministic lexicographic sort key. Uncertainty labels are descriptive model diagnostics, not statistical confidence intervals: fewer than 30 completed runs is `insufficient-data`; otherwise any partial/failed runs or a p95–p05 spread of at least 50% of the largest absolute tail/median magnitude yields `high`; a spread from 20% to below 50% yields `moderate`; otherwise the label is `low`. The spread calculation uses a denominator of at least one atomic unit/basis point. Reasons, sample size, completion rate, and maximum relative spread accompany the label.

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

The attacker executes first in configured order on tick zero. It makes one configured purchase, then waits until both the explicit hold duration has elapsed and cumulative retail-buyer base purchases meet the configured minimum. It exits the configured share at most once. Retail price disadvantage compares retail buyers' quote-weighted average execution price after entry with the post-entry spot price. Attacker PnL includes realized quote balance and remaining base marked at the final spot price, less its initial quote capital. These are modeled outcomes under the supplied distribution, not claims about actual users or guaranteed profits. A run requires at least one retail buyer, a bonding pool, no other sniper agents, and stays within a one-million agent-tick action budget.

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

The attacker makes one quote buy sized as `floor(migrationQuoteThresholdAtomic * migrationQuoteShareBps / 10000)` at an explicit tick, and has first configured execution priority on that tick. Price displacement compares the pool spot immediately before and after the fill. Post-buy concentration is the attacker's acquired base divided by the base held by all tracked agents immediately after the fill; unmodeled wallets are excluded. A trade that does not execute or is interrupted by an earlier modeled migration is retained as a partial iteration, not as zero impact. The run requires a bonding pool, no other whale archetypes, sufficient quote funding, and stays within a one-million agent-tick action budget.

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

The attacker buys its explicit quote amount at the configured tick, then waits for both the configured hold and cumulative momentum-trader base purchases to reach the required threshold before exiting its configured share once. Supporting agents execute before the attacker in configured order, so qualifying momentum purchases on the exit tick are applied before the dump. Late-buyer loss is the non-negative mark-to-market loss for the momentum cohort that bought after attacker entry and before exit, measured at the lowest subsequent observed spot. Recovery quote is the smallest simulated quote input that restores the final bonding-curve spot to the observed pre-recovery peak; it is zero if the market has already recovered. If the pool migrated or that peak is unreachable on the remaining curve, the iteration is partial rather than assigning a zero recovery cost. Attacker PnL includes its remaining base marked at final spot and its quote balance net of initial quote capital.

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

The attack distribution contains at least two explicit profit-taker/panic-seller agents, kept ahead of background agents in configured execution order; the background distribution cannot contain these cascade archetypes. Each attack iteration is paired with a no-cascade baseline using the same initial candidate, clock, background configuration, and iteration seed. A completed measurement requires at least two distinct cascade agents to sell and both traces to reach the DBC migration threshold. Migration delay is attack graduation time minus baseline graduation time in seconds; a negative value means the attacked run reached the threshold earlier. Quote outflow sums quote received by cascade agents. Recovery quote is calculated immediately after the last cascade sell to restore the pre-cascade peak, not after later background recovery. The recovery calculation follows the local DBC curve and does not assert post-migration market liquidity.

---

### Attack 5 — Fee-Schedule Exploit

Search for trade timing around fee-decay transitions.

Metrics:

```text
best entry timestamp
fee saved
PnL improvement
```

The MVP performs a deterministic round-trip sweep at the current eligible schedule point and every remaining fee-period boundary through the ending-fee period. Each candidate uses the same initial pool snapshot, quote buy size, and immediate full-base sell. The best entry clock maximizes quote PnL; ties keep the earliest candidate. Fee savings and PnL improvement compare the best candidate with the earliest completed candidate. Candidate failures remain in the result and are excluded from selection. This timing sweep consumes no randomness and therefore has no random seed; its candidate clocks and outcomes are the reproducibility record.

Attack result contracts and their scenario-specific metric units are defined in §20.2. Seeded attack runs preserve their seed, iteration counts, and engine/SDK versions so the outcome can be reproduced. The deterministic fee-schedule sweep instead records candidate clocks and outcomes without a seed. A failed run records a failure and must not be presented as a completed attack result.

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

The MVP's stochastic top-holder and top-ten metrics use the p95 share of base balances held by configured agents only. The whale-entry attack reports the attacker's p95 share of tracked agent base immediately after its configured buy. These are scenario-bounded modeled measurements; do not infer all-wallet or Sybil-resistant concentration from them. If the run has no tracked holder metric, report the category as unavailable rather than inventing zero concentration.

### Early Advantage

```text
first 10% quote average price
vs
median buyer average price
```

For each completed stochastic iteration, measure buyers' average quote spent per base acquired. The early tranche is the first 10% of total executed buy quote input, in retained event order; if its boundary falls inside a buy, re-quote that exact partial input against the pre-trade pool state. The median is the nearest-rank p50 of per-buyer average entry prices (lower middle for an even buyer count). Report the first-tranche price, median buyer price, and non-negative discount in bps; if there is insufficient quote/buyer data, mark the metric unavailable.

### Sniper Exposure

```text
modeled attacker profitability
```

Normalize the p95 signed quote PnL from an opening-sniper run by its explicitly supplied quote capital-at-risk amount. Do not infer capital from the attacker's PnL or unrelated run fields. Preserve both the signed PnL and denominator as evidence; negative PnL maps to zero positive-return basis points for severity while the signed loss remains visible.

### Exit Liquidity Sensitivity

```text
price decline caused by modeled sell sizes
```

The audit consumes post-exit p95 drawdown from the opening-sniper, pump-and-dump, and sell-cascade scenarios. Where an attack reports recovery quote or quote outflow, retain those asset-tagged p95 amounts as separate evidence; attack result fields are independently summarized, so the report must not imply that separate percentiles came from the same iteration.

### Migration Fragility

```text
how dependent graduation is on late-stage capital
```

Measure this with a paired stochastic baseline and a caller-described late-stage quote-capital stress using the same seed, versions, iteration count, and agent counts. Report DBC-threshold failure frequency as `10,000 bps - graduationFrequencyBps` for the stressed run, retain baseline/stress graduation frequency and the declared reduction, and do not claim the caller's stress description proves causal isolation. A missing stress pair is unavailable, not zero fragility.

### Fee Shock

```text
economic discontinuities caused by fee schedule changes
```

Compare effective scheduled base-fee numerators at adjacent eligible clocks for linear or exponential schedules. Exclude the stateful dynamic-fee component from this rate-step metric, retain exact numerator and fractional-bps changes, and round the absolute step up to whole bps only when applying severity thresholds. Keep each completed candidate's observed base and quote fee totals separately asset-tagged; do not add unlike assets or imply their percentiles are paired with the rate-step metric.

### Surplus Behavior

```text
expected migration overshoot
distribution of surplus
```

Report quote-reserve overshoot relative to the configured migration threshold and retain the threshold, overshoot, and protocol/partner/creator quote allocations as separate evidence. Deterministic observations come from curve-complete runs; stochastic p05/median/p95 summaries include only completed iterations that reach the threshold and retain the overshoot and allocation values as paired samples. Record the qualifying iteration count; if none graduate, the result is unavailable rather than a fabricated zero.

The current simulator caps curve fills at completion, so a zero-overshoot result may be a fill-clamp artifact and must not be treated as evidence that real transactions cannot overshoot. Recipient shares and rounding reflect simulator assumptions, not verified SDK/program parity. Keep these metrics separate from migration fees and DAMM liquidity.

### Post-Migration Liquidity

```text
locked %
vested %
immediately liquid %
```

Use the deterministic run's six creator/partner allocation buckets and the distributable liquidity-unit total. Report raw units per bucket, aggregate unlocked/vesting/permanently locked shares in basis points, and use aggregate unlocked share as the policy metric. Percentages are floored from exact integer units; they may sum to less than 10,000 bps because of rounding. If migration allocation is absent, report unavailable rather than assuming zero.

These are destination-liquidity units, not quote or base token amounts. Higher unlocked share is an exposure signal under the selected illustrative policy, not a universal judgment: it can improve flexibility and available market liquidity, while more vesting or permanent lock can constrain recipients. State any recommendation's trade-off, and do not imply lock execution or destination behavior is verified without protocol evidence.

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

The MVP uses one centralized, editable `AuditSeverityPolicy`. Every observation is retained in its raw unit before severity is derived. Findings and the enclosing audit result persist the policy id/version; the audit result also snapshots its thresholds so a report remains reproducible if a later policy is recalibrated. Rules must not embed numeric cutoffs. Hardening objectives use underlying numeric measurements, never severity labels.

The initial policy is `demo` / `demo-v1`, classified and labeled as an illustrative demo heuristic. Its thresholds are provisional examples only, not protocol guarantees, safety claims, or industry standards. Thresholds are in basis points and a value at or above the high threshold is `HIGH`; otherwise a value at or above the moderate threshold is `MODERATE`; lower values are `LOW`.

Finding-to-solver hardening maps only metrics with a semantically compatible candidate measurement. The current supported mappings are the deterministic early-curve price-impact rule to `earlyPriceImpact` only when the finding retains the first trade as a quote buy and the candidate probe exactly matches its input; it uses the original numeric intent limit (or zero as the solver's explicit minimization target). Opening-sniper p95 return maps to `attackProfitability` only when retained quote PnL/capital evidence reproduces the raw metric. The candidate evaluator must use a comparable configured scenario. Other findings remain visibly unsupported until a matching solver measurement exists. Never map severity labels or policy cutoffs into solver targets. Added risk weights are explicit, reserve a fraction below one, and proportionally scale the original objective weights so their relative economic priorities remain; original intent constraints are not rewritten.

Generate a hardened candidate by re-solving the unchanged normalized `MarketIntent` with the same simulator configuration and converted objective weights. Preserve the original candidate and selected finding records. Select only candidates that satisfy the original quote and distribution targets, meet the numeric maximum early-price-impact target at the same explicit quote probe when one is specified, and whose start/migration Q64.64 boundaries, supply, and deterministic simulation match the original intent/configuration. Reject candidates with a missing comparable early-impact measurement or an exceeded limit, and retain rejection reasons. The resulting curve remains `unverified` and is not deployable.

Re-run both the original and hardened candidate with identical deterministic trade actions, stochastic agent/tick configuration and master seed, and selected attack configurations and seeds. Apply the same optional warm-up quote to both candidates. Retain complete run outputs and seeds; represent setup/run exceptions explicitly and mark partial or failed suites rather than treating them as zero-risk results.

Produce a structured before/after comparison from the original and hardened candidates plus those paired replay outputs. The comparison artifact retains the full generation and resimulation records, including the original candidate, selected findings with evidence, and replay seeds/results. Report selected raw risk metrics and available deterministic, stochastic-p95, and attack metrics with their source references; do not collapse findings into a score or use severity labels as objective measurements. Include absolute quote-target error in quote atomic units, absolute base-distribution-target error in basis points, measured migration price and its relative target error, whether the curve-completion simulation reached migration, segment count, and base/quote fees as separate asset-tagged amounts. Preserve unavailable and partial measurements with their reasons; a failed run is never represented as zero risk. Label the comparison as modeled and retain `verificationStatus: "unverified"` until SDK/program or on-chain evidence justifies a stronger status.

The seeded hardening regression uses a deliberately selected higher-exposure feasible candidate, a 15% maximum-impact limit measured with an explicit $5,000 quote probe, $5,000 retail buys, a $100 opening-sniper buy, $500 quote capital at risk, two attack iterations, and attack master seed `9921`. Under this fixture, p95 attacker PnL falls from `12,562,158` to `9,961,208` quote atomic units; the raw positive-return metric falls from 251 to 199 bps. The replay uses the same attack configuration and derived iteration seeds for both candidates, preserves the original quote/distribution and numeric price-impact constraints, and remains modeled/unverified. This is a reproducible scenario result, not a general promise about other demand or attacker profiles.

| Metric | MODERATE at or above | HIGH at or above |
| --- | ---: | ---: |
| Early, mid-curve, late, and maximum trade price impact | 500 bps | 1,500 bps |
| Maximum drawdown | 1,500 bps | 3,000 bps |
| Top-holder concentration | 1,000 bps | 2,500 bps |
| Top-ten-holder concentration | 5,000 bps | 7,500 bps |
| Early-buyer price advantage | 1,000 bps | 2,500 bps |
| Sniper return | 500 bps | 1,500 bps |
| Exit recovery quote | 500 bps | 1,500 bps |
| Migration failure frequency | 1,000 bps | 3,000 bps |
| Fee-shock rate step | 100 bps | 500 bps |
| Migration surplus | 100 bps | 500 bps |
| Unlocked post-migration liquidity | 5,000 bps | 8,000 bps |

For price stability, deterministic trade impact is grouped by the midpoint of its before/after migration progress: early `[0, 3,334)`, middle `[3,334, 6,667)`, and late `[6,667, 10,001)` bps. Each reported stage value is the maximum single-trade impact observed in the supplied run, so it depends on the run's configured trade sizes and is not an intrinsic curve-depth guarantee. Stochastic summaries use the retained run's p95 of per-iteration maxima. Partial runs retain observed metrics and remain marked partial; absent observations are unavailable, never fabricated zeroes.

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

Validate the exact assembled configuration synchronously immediately before invoking a transaction builder. Pass only the validator's normalized accepted value to that builder. Invalid validation results or thrown validator errors must stop construction; thrown SDK details must not be returned to logs or user-facing errors. Transaction construction is local preparation and does not sign or submit.

`assessDeploymentBudget` accepts an unsigned legacy transaction and an explicit list of every account the builder plans to create, with each account's encoded data length. It requires the fixed Devnet RPC URL and genesis identity, obtains a fresh confirmed blockhash, quotes the message fee, checks the fee payer's confirmed SOL balance at or after that context slot, quotes rent exemption for each missing account, and adds all other SDK-declared lamport debits. Every required signer other than the fee payer must be declared by public key; undeclared or unnecessary signer declarations are rejected. The result records the message digest and required public signer addresses. It fails closed on an existing rent target, missing fee quote, unsafe RPC integer, or RPC error. The result is a time-bounded estimate, not a guarantee that later simulation or execution will succeed. The caller must include every rent account and every non-rent SOL debit; token-denominated costs require their own balance checks.

`previewDeploymentTransaction` accepts only a sufficient budget result and confirms that the unsigned legacy transaction still compiles to the exact fee-quoted message and declared signer set. It returns public instruction/program/account roles, required signer addresses, the message digest, blockhash expiry, and quoted budget components; it never returns a keypair, signature, or raw instruction data. Instruction names are decoded from the pinned DBC IDL. `simulateDeploymentTransaction` rechecks Devnet identity and blockhash lifetime, then simulates the same compiled legacy message with signature verification disabled and blockhash replacement disabled. It returns only the simulation slot, safe compute-unit count, and a sanitized success or failure category with an optional instruction index. It does not expose RPC logs, raw errors, account data, or return data, and it never signs or broadcasts. Simulation is evidence about that Devnet state and message at that time, not a guarantee of later execution.

`recordExplicitDeploymentDecision` records only an explicit approve/reject decision from the transaction's fee-payer address and binds it to the preview digest. Any future wallet adapter must route signing/broadcast through `executeAfterExplicitDeploymentApproval`, which snapshots the unsigned transaction, recomputes its digest and required signer list, and checks the still-connected fee payer, pinned Devnet identity, confirmed block height, and blockhash expiry before invoking the action with that snapshot. Missing, rejected, stale, mismatched, or unavailable approval evidence must not invoke that callback. This gate is a domain adapter and is not yet wired to a wallet-signing or broadcast path.

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
  p05: Value;
  median: Value;
  p95: Value;
};

type SimulationUncertaintyLabel = "insufficient-data" | "low" | "moderate" | "high";

type SimulationUncertainty = {
  label: SimulationUncertaintyLabel;
  reasons: readonly ("fewer-than-30-completed-runs" | "partial-or-failed-runs" | "wide-outcome-spread")[];
  requestedSampleSize: bigint;
  completedSampleSize: bigint;
  completionRateBps: bigint;
  relativeSpreadBps?: bigint;
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

type PostMigrationLiquidityAllocation = {
  distributableLiquidity: bigint;
  creator: { unlocked: bigint; permanentlyLocked: bigint; vesting: bigint };
  partner: { unlocked: bigint; permanentlyLocked: bigint; vesting: bigint };
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
  migrationFees: {
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  };
  surplus: {
    protocol: AssetAmount<"quote">;
    partner: AssetAmount<"quote">;
    creator: AssetAmount<"quote">;
  };
  liquidityAllocation?: PostMigrationLiquidityAllocation;
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

type EarlyParticipantAdvantageMetrics = {
  priceAdvantageBps: bigint;
  firstTenPercentQuoteAveragePrice: Decimal;
  medianBuyerAveragePrice: Decimal;
  quoteVolume: AssetAmount<"quote">;
};

type MigrationSurplusMetrics = {
  overshootBps: bigint;
  threshold: AssetAmount<"quote">;
  overshoot: AssetAmount<"quote">;
  protocol: AssetAmount<"quote">;
  partner: AssetAmount<"quote">;
  creator: AssetAmount<"quote">;
};

type StochasticSimulationSummary = {
  graduationFrequencyBps: bigint;
  quoteAccumulated: DistributionSummary<AssetAmount<"quote">>;
  baseDistributed: DistributionSummary<AssetAmount<"base">>;
  timeToMigrationSeconds?: DistributionSummary<bigint>;
  maximumDrawdownBps: DistributionSummary<bigint>;
  maximumPriceImpactBps: DistributionSummary<bigint>;
  topHolderConcentrationBps?: DistributionSummary<bigint>;
  topTenHolderConcentrationBps?: DistributionSummary<bigint>;
  earlyParticipantAdvantage?: DistributionSummary<EarlyParticipantAdvantageMetrics>;
  earlyParticipantAdvantageSampleSize?: bigint;
  migrationSurplus?: DistributionSummary<MigrationSurplusMetrics>;
  migrationSurplusSampleSize?: bigint;
  feesGenerated: DistributionSummary<AssetAmountPair>;
  creatorFees?: DistributionSummary<AssetAmountPair>;
  sniperExtractionQuote?: DistributionSummary<AssetAmount<"quote">>;
};

type StochasticIterationOutcome = {
  id: string;
  randomSeed: bigint;
  randomAlgorithm: "splitmix64-v1";
  status: "completed" | "partial" | "failed";
  completedTicks: bigint;
  failure?: SimulationFailure;
};

type StochasticSimulationResult = SimulationRunMetadata & {
  kind: "stochastic";
  status: "completed" | "partial";
  randomSeed: bigint;
  randomAlgorithm: "splitmix64-v1";
  requestedIterations: bigint;
  completedIterations: bigint;
  partialIterations: bigint;
  failedIterations: bigint;
  agentCounts: AgentCounts;
  iterationOutcomes: readonly StochasticIterationOutcome[];
  uncertainty: SimulationUncertainty;
  summary: StochasticSimulationSummary;
};

type FailedStochasticSimulationResult = SimulationRunMetadata & {
  kind: "stochastic";
  status: "failed";
  randomSeed: bigint;
  randomAlgorithm: "splitmix64-v1";
  requestedIterations: bigint;
  completedIterations: 0n;
  partialIterations: bigint;
  failedIterations: bigint;
  iterationOutcomes: readonly StochasticIterationOutcome[];
  uncertainty: SimulationUncertainty;
  failure: SimulationFailure;
};

type FailedDeterministicSimulationResult = SimulationRunMetadata & {
  kind: "deterministic";
  status: "failed";
  failure: SimulationFailure;
};

type FailedSimulationResult = FailedStochasticSimulationResult | FailedDeterministicSimulationResult;

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
type SeededAttackScenario = Exclude<AttackScenario, "fee-schedule-timing">;

type AttackIterationOutcome = {
  id: string;
  randomSeed: bigint;
  randomAlgorithm: "splitmix64-v1";
  status: "completed" | "partial" | "failed";
  completedTicks: bigint;
  failure?: AttackFailure;
};

type AttackRunMetadata = {
  id: string;
  randomSeed: bigint;
  randomAlgorithm: "splitmix64-v1";
  requestedIterations: bigint;
  completedIterations: bigint;
  partialIterations: bigint;
  failedIterations: bigint;
  iterationOutcomes: readonly AttackIterationOutcome[];
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
  feesSaved: AssetAmountPair;
  pnlImprovementQuote: AssetAmount<"quote">;
};

type FeeScheduleCandidateOutcome = {
  candidateIndex: bigint;
  entryClock: SimulationClock;
  status: "completed" | "failed";
  feesPaid?: AssetAmountPair;
  pnlQuote?: AssetAmount<"quote">;
  failure?: AttackFailure;
};

type FeeScheduleTimingRunMetadata = {
  id: string;
  scenario: "fee-schedule-timing";
  status: "completed" | "partial" | "failed";
  candidateCount: bigint;
  completedCandidates: bigint;
  failedCandidates: bigint;
  candidateOutcomes: readonly FeeScheduleCandidateOutcome[];
  engineVersion: string;
  sdkVersion: string;
  startedAtSeconds: bigint;
  completedAtSeconds: bigint;
};

type FeeScheduleTimingResult = FeeScheduleTimingRunMetadata & {
  status: "completed" | "partial";
  metrics: FeeScheduleTimingMetrics;
};

type FailedFeeScheduleTimingResult = FeeScheduleTimingRunMetadata & {
  status: "failed";
  failure: AttackFailure;
};

type CompletedAttackResult<Scenario extends AttackScenario, Metrics> =
  AttackRunMetadata & {
    scenario: Scenario;
    status: "completed" | "partial";
    metrics: Metrics;
  };

type FailedAttackResult = AttackRunMetadata & {
  scenario: SeededAttackScenario;
  status: "failed";
  failure: AttackFailure;
};

type AttackResult =
  | CompletedAttackResult<"opening-sniper", OpeningSniperMetrics>
  | CompletedAttackResult<"whale-entry", WhaleEntryMetrics>
  | CompletedAttackResult<"pump-and-dump", PumpAndDumpMetrics>
  | CompletedAttackResult<"sell-cascade", SellCascadeMetrics>
  | FeeScheduleTimingResult
  | FailedAttackResult
  | FailedFeeScheduleTimingResult;
```

The CLI wraps an attack result with the explicit market intent, objective weights, simulator configuration, scenario assumptions, and selected candidate ID. An optional positive `preScenarioBuyQuoteAtomic` performs an exact deterministic quote-token buy against the verified initial curve before the attack and is recorded as an assumption. A candidate compiled for an attack remains labeled `curve-draft` with `verificationStatus: "unverified"` until complete DBC configuration and token-supply validation exist. The report's evidence classification is `modeled`, and its status must never imply deployability.

Quote/base quantities are asset-tagged atomic amounts. Prices are `Decimal`, percentages/concentration/drawdown are basis points, and durations/iteration counts use `bigint`. Attack metrics summarize completed seeded iterations; partial and failed outcomes remain visible but are excluded from distributions. If no iteration completes, return a failed result with no fabricated metrics. Fee-pair percentile components are summarized independently by asset. Attack runs preserve the exact iteration seeds and status so they can be replayed; the scenario does not imply that its assumed participants or behavior represent real users.

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
  severityMetric: AuditSeverityMetric;
  severityValueBps: bigint;
  severityThresholds: AuditSeverityThreshold;
  severityPolicyId: string;
  severityPolicyVersion: string;
  severityPolicyClassification: "illustrative-demo-heuristic";
  title: string;
  summary: string;
  evidence: readonly [AuditEvidence, ...AuditEvidence[]];
  suggestedRemediations: readonly string[];
};

type AuditSeverityThreshold = {
  moderateAtOrAboveBps: bigint;
  highAtOrAboveBps: bigint;
};

type AuditSeverityPolicy = {
  id: string;
  version: string;
  classification: "illustrative-demo-heuristic";
  label: string;
  thresholds: Readonly<Record<AuditSeverityMetric, AuditSeverityThreshold>>;
};

type AuditSeverityMetric =
  | "early-price-impact-bps"
  | "mid-price-impact-bps"
  | "late-price-impact-bps"
  | "maximum-price-impact-bps"
  | "maximum-drawdown-bps"
  | "top-holder-concentration-bps"
  | "top-ten-holder-concentration-bps"
  | "early-buyer-price-advantage-bps"
  | "sniper-return-bps"
  | "exit-recovery-quote-bps"
  | "migration-failure-frequency-bps"
  | "fee-shock-bps"
  | "migration-surplus-bps"
  | "unlocked-post-migration-liquidity-bps";

type AuditMetricObservation = {
  category: AuditFindingCategory;
  ruleId: string;
  source: AuditEvidenceSource;
  reference: string;
  metric: AuditSeverityMetric;
  valueBps: bigint;
  metricDescription: string;
  supportingEvidence?: readonly AuditEvidence[];
};

type OpeningSniperAuditRun = {
  result: OpeningSniperResult;
  capitalAtRiskQuote: AssetAmount<"quote">;
};

type LateStageCapitalStressPair = {
  baselineRun: StochasticSimulationResult;
  lateStageStressRun: StochasticSimulationResult;
  lateStageQuoteCapitalReductionBps: bigint;
};

type FeeShockAuditRun = {
  result: FeeScheduleTimingResult;
  initialState: PoolState;
};

type PriceStabilityAuditResult = {
  auditId: string;
  candidateId: string;
  category: "price-stability";
  status: "completed" | "partial" | "unavailable";
  evidenceClassification: "modeled";
  severityPolicy: AuditSeverityPolicy;
  observations: readonly AuditMetricObservation[];
  findings: readonly AuditFinding[];
};
```

Each evidence reference must resolve to a retained run, parity case, or on-chain observation and identify the exact metric/unit. A finding must not claim stronger evidence than its source supports. Remediations are suggestions tied to controllable inputs and must state material trade-offs; finding creation rejects a recommendation without an explicit trade-off. Findings are not guarantees or a single-number safety score. Audit outputs retain raw per-metric observations and classifications; they do not produce aggregate safety or risk scores.

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
  messageDigestHex?: string;
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

The status fields describe lifecycle evidence, not authorization logic: runtime validation must enforce legal transitions and require recorded explicit user approval before signing or broadcast. An approval is bound to the exact fee-quoted message digest and fee-payer wallet address. Immediately before an approved action, recompute the digest from the unsigned transaction, confirm the same wallet is connected, recheck the pinned Devnet endpoint/genesis and blockhash lifetime, and stop on any mismatch or unavailable check. Only public chain identifiers and transaction data belong in this record; never include private keys, seed phrases, signer objects, or other signing material. `verified` requires fetched on-chain state and a completed comparison; mismatches remain explicit and must not be hidden by a successful transaction confirmation.

The current web preflight checks the fixed Solana Devnet RPC identity and a connected wallet's public Devnet account plus legacy-transaction capability. This is access readiness only: it creates no `DeploymentRecord`, validates no assembled SDK configuration or balance, and does not build, sign, or send a transaction. The budget adapter is tested separately but is not yet wired to the SDK transaction builder or the web preflight. A passing preflight must not advance deployment or candidate verification status.

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

These checks do not replace the pinned SDK's `validateConfigParameters` or establish protocol parity. In particular, the domain allocation shape does not include vesting schedules, so it cannot prove that at least 10% remains locked one day after migration. `validateCompleteSdkConfigCandidate` in `src/meteora/complete-config-validation.ts` requires the complete fixed-supply amounts, a non-default leftover receiver, and both SDK vesting schedules; it checks the one day locked-liquidity basis points with `calculateLockedLiquidityBpsAtTime` and `validateMinimumLockedLiquidity`, then invokes the pinned SDK's `validateConfigParameters`. SDK exceptions are replaced with a static safe issue. Its `sdk-validated` result is candidate evidence only and does not imply signing, submission, or on-chain verification.

`buildMeteoraConfigTransaction` in `src/meteora/deployment-config-builder.ts` is Devnet-only and runs `validateCompleteSdkConfigCandidate` immediately before calling `DynamicBondingCurveClient.create(connection).partner.createConfig` from pinned SDK 1.5.13. It accepts only public account addresses, requires on-curve config and payer signer addresses, and returns the unsigned `create_config` transaction with the payer set as fee payer and the config signer address declared for later budget/preview checks. It generates and retains no keypair, signs nothing, and makes no RPC request. A caller must retain any config signer keypair outside this result. Exact config account allocation/rent is not inferred here; the budget caller must supply program-verified account sizing before treating its estimate as sufficient.

The implementation boundary `constructDeploymentTransactionAfterValidation` runs a supplied validator immediately before a supplied local builder, forwards only the validated value, and blocks on invalid results or exceptions. The configuration transaction builder uses this boundary; pool creation, budget/preview wiring, signing, submission, and on-chain verification remain separate work.

## 20.7 Versioned market audit report

The web studio exports a JSON artifact after a successful or partial audit. Version 1 uses the stable `reportType` value `tymba.market-audit-report` and a numeric `schemaVersion` of `1`. Consumers must reject unsupported versions rather than guessing how fields should be interpreted.

The report includes the validated market intent, explicit objective weights and simulation settings, deterministic trade inputs, retained attack configurations, solver engine/algorithm/SDK versions, selected curve-draft parameters in their exact encoded units, measured candidate metrics, attack master and per-iteration seeds, audit policy/version, findings, and the complete retained source-evidence snapshot. Deterministic runs explicitly have no random seed; the fee-schedule boundary sweep is also seedless. The artifact has no generated timestamp or random report ID so identical inputs and results serialize reproducibly.

The top-level contract is:

```ts
type MarketAuditReportV1 = {
  reportType: "tymba.market-audit-report";
  schemaVersion: 1;
  evidenceClassification: "modeled";
  verificationStatus: VerificationStatus;
  input: {
    marketIntent: JsonValue;
    objectiveWeights: JsonValue;
    simulation: JsonValue;
    deterministicTrades: readonly JsonValue[];
    attacks: readonly JsonValue[];
  };
  solver: {
    status: "blocked" | "failed";
    solverStatus?: SolverStatus;
    engineVersion: string;
    algorithmVersion: string;
    sdkVersion: string;
  };
  candidate: {
    id: string;
    rank: number;
    objectiveScore: string;
    metrics: JsonValue;
    parameters: JsonValue;
  };
  reproducibility: {
    deterministicRun: { id: string; randomSeed: null; seedPolicy: string };
    attacks: readonly {
      scenario: string;
      seedPolicy: string;
      masterSeed: string | null;
      iterationSeeds: readonly string[];
    }[];
  };
  audit: {
    status: "completed" | "partial";
    policy: JsonValue;
    categories: readonly JsonValue[];
    sourceEvidence: JsonValue;
  };
};
```

The implementation is in `src/web/report.ts`. Sensitive object fields matching private-key, API-key, authentication-token, credential, secret, mnemonic, seed-phrase, signer, keypair, or signing-material names are excluded recursively. Simulation random seeds remain included because they reproduce modeled runs and are not wallet or signing secrets. Reports contain no wallet signing material, private keys, credentials, or deployment approval data. Version 1 is an exported artifact; it does not imply persistence, a hosted share link, SDK full-config validation, or on-chain verification.

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

Current root web implementation connects reviewed structured intent, curve-draft compilation and visualization, deterministic scripts, five explicit attack models, evidence-backed audits with a versioned heuristic policy, paired numeric-objective hardening, exact advanced curve units, and versioned audit report export. A read-only Devnet and wallet preflight is now available after candidate selection. A pinned-SDK Devnet config transaction builder exists for fully validated candidates, but is not wired to the web flow, budget/preview adapters, wallet, or submission path; outputs remain modeled/unverified and non-deployable. The web audit lacks standalone stochastic-cohort and paired late-capital-stress inputs; absent categories remain unavailable. Hardening requires a retained script, reviewed stochastic population/seed, and retained attack configurations without warm-ups. Budget/preview wiring, pool initialization, approval UI, destination LP settlement, actual deployment, on-chain verification, and automatic prose interpretation remain separate pending work. Editing source inputs invalidates dependent results.

`buildMeteoraMarketTransaction` is an additional low-level Devnet adapter for an already complete SDK candidate. It revalidates the candidate immediately before the pinned SDK 1.5.13 combined config-and-pool builder, confirms the fixed Devnet genesis and a classic SPL quote mint with caller-specified decimals, requires token name/symbol/metadata URI, and returns an unsigned transaction plus derived public addresses, signer addresses, rent targets, and any configured pool-creation SOL debit. It rejects transactions that exceed Solana's legacy wire-packet limit. The current-source account lengths are marked unverified against the deployed Devnet programs; the transaction is not connected to the studio and nothing is signed or submitted. The compile pipeline still emits no complete SDK candidate, so this adapter cannot deploy current studio drafts.

The product-flow claims boundary uses shared, visible stage-specific evidence notices (`src/web/evidence.ts`, `src/web/EvidenceNotice.tsx`). Compile scope warnings are not hidden behind details. Satisfied core targets do not promise demand or fundraising; curve/script completion does not prove on-chain migration; attack percentiles are sample observations, not future bounds. LOW/MODERATE/HIGH remain provisional versioned heuristic classifications, not safety certificates, and missing evidence is not zero risk. Hardening run completion is distinct from per-metric improvement under tested inputs; partial comparisons remain explicitly partial and unavailable comparisons have no improvement assessment. These presentation constraints do not change domain metrics, policy thresholds, or verification status.

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
pnpm tymba compile examples/demo-compile-request.json
```

The compile-request envelope contains the canonical `MarketIntent`, explicit objective weights, and deterministic simulator configuration. `MarketIntent` remains the economic input; objective weights and simulator state are separate and must not be silently defaulted. See `examples/demo-compile-request.json` for a full request. A MarketIntent-only file is rejected with a clear request for the missing solver configuration. Until the pinned SDK's complete DBC configuration and token-supply validators are wired into compilation, the CLI may return simulator-checked, SDK-curve-validated drafts with a `blocked` status; their protocol `verificationStatus` remains `unverified`, and no deployable configuration may be emitted.

The following is the `marketIntent` portion of the compile request:

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
Compile: BLOCKED
Deployable candidates: 0
Curve drafts: 13
Solver status: satisfied
Failure: complete DBC configuration and token-supply validation are not implemented.
```

The curve-draft count and economic metrics depend on the explicit compile request. A blocked result must not be presented as compiled or deployable.

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
