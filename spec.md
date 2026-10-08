Warning: truncated output (original token count: 33881)
Total output lines: 3558

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
- Attack-profitability penalty: `max(attackerProfitQuoteAtomic, 0) / attackerCapitalQuoteAtomic`; capital must be positive. A positively weighted attack term requires an identifi…17881 tokens truncated…tion-surplus-bps"
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

The current web preflight checks the fixed Solana Devnet RPC identity and a connected wallet's public Devnet account plus legacy-transaction capability. This is access readiness only: it creates no `DeploymentRecord`, validates no assembled SDK configuration or balance, and does not build, sign, or send a transaction. The `demo-v1` adapter can independently build and validate an offline candidate and can assemble an unsigned config-and-pool transaction after runtime wallet and metadata resolution. The budget, preview, simulation, and approval evidence have not yet been wired to the web flow or to a broadcaster. A passing preflight must not advance deployment or candidate verification status.

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

## 20.8 Versioned deployment candidate

`DeploymentCandidate` is a versioned offline artifact. It is distinct from an approved transaction and from a `DeploymentRecord`:

```ts
type DeploymentCandidate = {
  schemaVersion: 1;
  profileId: "demo-v1";
  network: "devnet";
  market: CompiledMarket & {
    objectiveWeights: JsonValue;
    deploymentConfiguration: {
      baseToken: { name: string; symbol: string; decimals: 9; supplyMode: "fixed"; totalSupply: string };
      quoteToken: { symbol: "USDC"; decimals: 6; mint: string; liveVerification: "required-before-transaction-preflight" };
      poolCreationFeeLamports: string;
    };
  };
  migration: MigrationConfiguration;
  authority: { mode: "runtime-deployer"; publicKey?: string };
  metadata: { uri: string; status: "unresolved" | "resolved"; assetPath: string };
  sdkConfig: JsonValue;
  sdkValidation: JsonValue;
  assumptions: readonly string[];
};
```

An unresolved candidate is complete enough for offline SDK assembly, validation, deterministic serialization, and review. It carries no invented authority address or signer material. The `sdkValidation` evidence states that SDK config parameter validation deferred receiver-dependent supply validation and that fixed-supply bounds were checked separately with pinned SDK helpers. Resolving the deployer supplies a real public key for the leftover receiver and reruns the full SDK validator before transaction construction.

`buildCandidate()` selects a deterministic compiled curve draft and maps the versioned profile into pinned SDK 1.5.13 parameters. `prepareDeployment()` rejects structurally incomplete or internally inconsistent candidates, canonicalizes protocol integers as decimal strings, and computes a SHA-256 digest of the serialized candidate. This digest identifies candidate contents; it is not a transaction-message digest and is not user approval.

The runtime candidate adapter requires a connected wallet matching `authority.publicKey` and a resolved HTTPS/IPFS metadata URI before constructing the SDK config-and-pool transaction. The low-level builder verifies the Devnet genesis, classic SPL quote mint, and quote decimals before returning an unsigned transaction. The transaction must subsequently pass budget, preview, simulation, and digest-bound explicit approval. The current `sendDeployment()` is a readiness gate only and does not sign or broadcast. Candidate and transaction artifacts must never contain private keys, secrets, or wallet signing material.

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

Current root web implementation connects reviewed structured intent, curve-draft compilation and visualization, deterministic scripts, five explicit attack models, evidence-backed audits with a versioned heuristic policy, paired numeric-objective hardening, exact advanced curve units, and versioned audit report export. A read-only Devnet and wallet preflight is available after candidate selection. Phase 8 now has the schema-versioned seeded `demo-v1` profile, offline candidate assembly/validation/serialization, runtime wallet and metadata resolution, unsigned pinned-SDK config/pool transaction assembly, budget and preview/simulation gates, digest-bound approval, and a Wallet Standard sender adapter. The sender adapter is not connected to the studio. The metadata assets are hosted and fetched through GitHub Pages; the candidate URI remains unresolved until explicit runtime resolution. No wallet prompt, signature, or transaction has occurred. Deployment record persistence, on-chain state fetch, parity verification, and automatic prose interpretation remain open. The web audit lacks standalone stochastic-cohort and paired late-capital-stress inputs; absent categories remain unavailable. Hardening requires a retained script, reviewed stochastic population/seed, and retained attack configurations without warm-ups. Editing source inputs invalidates dependent results.

`buildDemoV1MarketTransaction` takes the offline candidate plus a connected deployer public key, config/base-mint signer public keys, and a Devnet connection. It refuses unresolved authority or metadata before RPC use, binds the deployer to payer, pool creator, fee claimer, and leftover receiver, and delegates to `buildMeteoraMarketTransaction`. That low-level Devnet adapter revalidates the fully assembled candidate immediately before the pinned SDK 1.5.13 combined config-and-pool builder, confirms the fixed Devnet genesis and a classic SPL quote mint with the fixture's six decimals, requires token name/symbol/metadata URI, and returns an unsigned transaction plus derived public addresses, signer addresses, rent targets, and any configured pool-creation SOL debit. It rejects transactions that exceed Solana's legacy wire-packet limit. The current-source account lengths are marked unverified against the deployed Devnet programs; tests mock identity and quote-mint reads, and nothing is signed or submitted. The compile CLI still emits curve drafts only; the separate deployment API uses the seeded profile and does not yet connect to the studio.

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

The compile-request envelope contains the canonical `MarketIntent`, explicit objective weights, and deterministic simulator configuration. `MarketIntent` remains the economic input; objective weights and simulator state are separate and must not be silently defaulted. See `examples/demo-compile-request.json` for a full request. A MarketIntent-only file is rejected with a clear request for the missing solver configuration. The compile CLI returns simulator-checked, SDK-curve-validated drafts with a `blocked` status; their protocol `verificationStatus` remains `unverified`, and no deployable configuration is emitted from that command. Separately, the Phase 8 `buildCandidate()` API combines the tracked compile request with versioned profile `demo-v1` to create and serialize a complete offline SDK candidate; it defers runtime receiver-dependent validation and is not wired to the studio or compile CLI.

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
