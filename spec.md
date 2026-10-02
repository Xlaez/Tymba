# Tymba — Product & Technical Specification

> **Working name:** Tymba  
> **Tagline:** Design. Attack. Deploy.  
> **One-line product:** A compiler, simulator, and economic audit engine for Meteora Dynamic Bonding Curve (DBC) markets.

---

## 1. Executive Summary

Tymba turns human-readable token-launch goals into valid Meteora DBC configurations, simulates how those configurations behave under realistic and adversarial trading conditions, explains the resulting economics in plain English, and deploys approved configurations to Meteora.

Meteora DBC exposes a powerful but low-level market primitive:

- starting price,
- up to 16 increasing-price liquidity segments,
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

---

## 6.3 Surplus

The engine must model quote surplus at migration.

Example:

```text
Migration threshold: 100 SOL
Final purchase moves reserve to: 105 SOL
Surplus: 5 SOL
```

Surplus should not be ignored in economic simulations.

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

---

# 7. Inverse DBC Solver

This is the core technical differentiator.

---

## 7.1 Input

Define:

```ts
type MarketIntent = {
  tokenSupply: bigint;

  startPrice?: number;
  startFdv?: number;

  migrationPrice?: number;
  migrationFdv?: number;

  quoteTarget?: number;
  targetBaseDistributedPct?: number;

  maxSegments?: number;

  earlyPriceImpactTarget?: number;
  earlyBuyerAdvantageTarget?: number;

  launchProfile?: "deep" | "balanced" | "momentum";

  feeIntent?: {
    sniperResistance: "low" | "medium" | "high";
    dynamicFees: boolean;
  };

  migrationIntent?: {
    creatorLockedPct?: number;
    partnerLockedPct?: number;
    unlockedPct?: number;
    lockDurationSeconds?: number;
  };
};
```

---

## 7.2 Output

```ts
type SolvedMarket = {
  status: "satisfied" | "partial" | "unsatisfied";

  curve: CurveSegment[];

  metrics: {
    quoteToMigration: number;
    baseDistributed: number;
    baseDistributedPct: number;
    migrationPrice: number;
    migrationFdv: number;
  };

  fees: FeeConfiguration;

  migration: MigrationConfiguration;

  explanations: Explanation[];

  warnings: SolverWarning[];
};
```

---

## 7.3 Curve segment

```ts
type CurveSegment = {
  lowerPrice: number;
  upperPrice: number;
  liquidity: number;

  expectedQuoteAbsorption: number;
  expectedBaseDistribution: number;
};
```

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

---

# 8. Deterministic Simulator

The deterministic simulator must reproduce DBC behavior closely enough that generated metrics are trustworthy.

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

The simulator should be tested against the official Meteora SDK wherever possible.

---

## 8.1 Core simulator API

```ts
interface DbcSimulator {
  quoteBuy(inputQuote: bigint, state: PoolState): BuyResult;
  quoteSell(inputBase: bigint, state: PoolState): SellResult;

  executeBuy(inputQuote: bigint, state: PoolState): PoolState;
  executeSell(inputBase: bigint, state: PoolState): PoolState;

  getSpotPrice(state: PoolState): number;
  getMigrationProgress(state: PoolState): number;
}
```

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
market recovery
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

```ts
type CurrencyAmount = {
  raw: bigint;
  decimals: number;
};

type PriceRange = {
  lower: number;
  upper: number;
};

type CurveSegment = {
  index: number;
  price: PriceRange;
  liquidity: bigint;
};

type DbcCurve = {
  startPrice: number;
  segments: CurveSegment[];
  migrationQuoteThreshold: bigint;
};

type MarketIntent = {
  tokenSupply: bigint;

  startFdv?: number;
  migrationFdv?: number;

  quoteTarget?: number;
  targetBaseDistributionPct?: number;

  launchProfile?: "deep" | "balanced" | "momentum";

  constraints?: {
    maxEarlyPriceImpactPct?: number;
    maxSegments?: number;
  };
};

type SimulationMetrics = {
  migrated: boolean;
  finalPrice: number;
  quoteReserve: bigint;
  baseDistributed: bigint;

  maxDrawdownPct: number;
  maxPriceImpactPct: number;

  topHolderPct?: number;
  topTenPct?: number;

  feesGenerated: bigint;
};

type AttackResult = {
  attackType: string;
  attackerPnl: number;
  maxDrawdownPct: number;
  victimPriceDisadvantagePct?: number;
  notes: string[];
};
```

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

Fail if error exceeds an acceptable tolerance.

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
  "tokenSupply": "1000000000",
  "startFdv": 200000,
  "migrationFdv": 2000000,
  "quoteTarget": 150000,
  "targetBaseDistributionPct": 25,
  "maxSegments": 3
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

1. Exact current SDK representation of curve points.
2. Integer precision and rounding behavior.
3. Exact maximum supported curve segments in the currently deployed DBC program.
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
