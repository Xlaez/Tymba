import { Decimal } from "decimal.js";
import { MAX_CURVE_U64 } from "./curve.js";
import type { SimulationAgent } from "./stochastic-simulation.js";
import type { SimulationAgentObservation, SimulationAction } from "./stochastic-simulation.js";
import type { SeededRandom } from "./seeded-random.js";

const ExactDecimal = Decimal.clone({ precision: 512, toExpNeg: -100_000, toExpPos: 100_000 });

export type AgentFunding = Readonly<{
  id: string;
  initialQuoteBalanceAtomic: bigint;
  initialBaseBalanceAtomic: bigint;
  initialBaseCostBasisQuoteAtomic: bigint;
}>;

export type RetailBuyerConfiguration = AgentFunding &
  Readonly<{
    archetype: "retail-buyer";
    minimumBuyQuoteAtomic: bigint;
    maximumBuyQuoteAtomic: bigint;
    buyProbabilityBps: bigint;
    sellProbabilityBps: bigint;
    sellShareBps: bigint;
  }>;

export type WhaleConfiguration = AgentFunding &
  Readonly<{
    archetype: "whale";
    entryTickIndex: bigint;
    buyQuoteAtomic: bigint;
  }>;

export type SniperConfiguration = AgentFunding &
  Readonly<{
    archetype: "sniper";
    buyQuoteAtomic: bigint;
    holdTicks: bigint;
    minimumOtherBuyerBaseAtomic: bigint;
    exitShareBps: bigint;
  }>;

export type MomentumTraderConfiguration = AgentFunding &
  Readonly<{
    archetype: "momentum-trader";
    priceIncreaseThresholdBps: bigint;
    buyQuoteAtomic: bigint;
    maximumPurchases: bigint;
  }>;

export type ProfitTakerConfiguration = AgentFunding &
  Readonly<{
    archetype: "profit-taker";
    entryTickIndex: bigint;
    buyQuoteAtomic: bigint;
    targetGainBps: bigint;
    sellShareBps: bigint;
  }>;

export type PanicSellerConfiguration = AgentFunding &
  Readonly<{
    archetype: "panic-seller";
    entryTickIndex: bigint;
    buyQuoteAtomic: bigint;
    drawdownThresholdBps: bigint;
    sellShareBps: bigint;
  }>;

export type RandomTraderConfiguration = AgentFunding &
  Readonly<{
    archetype: "random-trader";
    buyProbabilityBps: bigint;
    sellProbabilityBps: bigint;
    minimumBuyQuoteAtomic: bigint;
    maximumBuyQuoteAtomic: bigint;
    sellShareBps: bigint;
  }>;

export type MvpAgentConfiguration =
  | RetailBuyerConfiguration
  | WhaleConfiguration
  | SniperConfiguration
  | MomentumTraderConfiguration
  | ProfitTakerConfiguration
  | PanicSellerConfiguration
  | RandomTraderConfiguration;

export type MvpAgentConfigurationMap = Readonly<{
  "retail-buyer": RetailBuyerConfiguration;
  whale: WhaleConfiguration;
  sniper: SniperConfiguration;
  "momentum-trader": MomentumTraderConfiguration;
  "profit-taker": ProfitTakerConfiguration;
  "panic-seller": PanicSellerConfiguration;
  "random-trader": RandomTraderConfiguration;
}>;

export function createMvpAgent(configuration: MvpAgentConfiguration): SimulationAgent {
  validateFunding(configuration);
  validateAgentConfiguration(configuration);

  return {
    id: configuration.id,
    archetype: configuration.archetype,
    initialQuoteBalanceAtomic: configuration.initialQuoteBalanceAtomic,
    initialBaseBalanceAtomic: configuration.initialBaseBalanceAtomic,
    initialBaseCostBasisQuoteAtomic: configuration.initialBaseCostBasisQuoteAtomic,
    decide: createDecision(configuration),
  };
}

function createDecision(
  configuration: MvpAgentConfiguration,
): (observation: SimulationAgentObservation, random: SeededRandom) => SimulationAction {
  switch (configuration.archetype) {
    case "retail-buyer":
      return (observation, random) => {
        if (observation.portfolio.baseBalanceAtomic > 0n) {
          if (random.nextBelow(10_000n) < configuration.sellProbabilityBps) {
            return sellShare(observation.portfolio.baseBalanceAtomic, configuration.sellShareBps);
          }
        }
        if (
          observation.portfolio.quoteBalanceAtomic < configuration.minimumBuyQuoteAtomic ||
          random.nextBelow(10_000n) >= configuration.buyProbabilityBps
        ) {
          return { kind: "wait" };
        }
        return {
          kind: "buy",
          inputAtomic: chooseBuySize(
            configuration.minimumBuyQuoteAtomic,
            configuration.maximumBuyQuoteAtomic,
            observation.portfolio.quoteBalanceAtomic,
            random,
          ),
        };
      };
    case "whale":
      return (observation) => {
        if (
          observation.tickIndex !== configuration.entryTickIndex ||
          observation.portfolio.successfulBuyCount > 0n ||
          observation.portfolio.quoteBalanceAtomic < configuration.buyQuoteAtomic
        ) {
          return { kind: "wait" };
        }
        return { kind: "buy", inputAtomic: configuration.buyQuoteAtomic };
      };
    case "sniper":
      return (observation) => {
        const portfolio = observation.portfolio;
        if (portfolio.successfulBuyCount === 0n && observation.tickIndex === 0n) {
          return portfolio.quoteBalanceAtomic >= configuration.buyQuoteAtomic
            ? { kind: "buy", inputAtomic: configuration.buyQuoteAtomic }
            : { kind: "wait" };
        }
        if (
          portfolio.baseBalanceAtomic > 0n &&
          portfolio.successfulSellCount === 0n &&
          portfolio.firstBuyTickIndex !== undefined &&
          observation.tickIndex - portfolio.firstBuyTickIndex >= configuration.holdTicks &&
          observation.cumulativeBaseBoughtAtomicByArchetype["retail-buyer"] >=
            configuration.minimumOtherBuyerBaseAtomic
        ) {
          return sellShare(portfolio.baseBalanceAtomic, configuration.exitShareBps);
        }
        return { kind: "wait" };
      };
    case "momentum-trader": {
      let previousPrice: Decimal | undefined;
      return (observation) => {
        const priorPrice = previousPrice;
        previousPrice = observation.spotPrice;
        if (
          priorPrice === undefined ||
          observation.portfolio.successfulBuyCount >= configuration.maximumPurchases ||
          observation.portfolio.quoteBalanceAtomic < configuration.buyQuoteAtomic
        ) {
          return { kind: "wait" };
        }
        const increaseBps = new ExactDecimal(observation.spotPrice.toString())
          .minus(priorPrice)
          .mul("10000")
          .div(priorPrice)
          .floor();
        return increaseBps.greaterThanOrEqualTo(configuration.priceIncreaseThresholdBps)
          ? { kind: "buy", inputAtomic: configuration.buyQuoteAtomic }
          : { kind: "wait" };
      };
    }
    case "profit-taker":
      return (observation) => {
        if (
          observation.portfolio.baseBalanceAtomic === 0n &&
          observation.portfolio.successfulBuyCount === 0n &&
          observation.tickIndex === configuration.entryTickIndex &&
          observation.portfolio.quoteBalanceAtomic >= configuration.buyQuoteAtomic
        ) {
          return { kind: "buy", inputAtomic: configuration.buyQuoteAtomic };
        }
        const entryPrice = observation.portfolio.averageEntryPrice;
        if (!entryPrice || observation.portfolio.baseBalanceAtomic === 0n) return { kind: "wait" };
        const gainBps = new ExactDecimal(observation.spotPrice.toString())
          .minus(entryPrice)
          .mul("10000")
          .div(entryPrice)
          .floor();
        return gainBps.greaterThanOrEqualTo(configuration.targetGainBps)
          ? sellShare(observation.portfolio.baseBalanceAtomic, configuration.sellShareBps)
          : { kind: "wait" };
      };
    case "panic-seller":
      return (observation) => {
        if (
          observation.portfolio.baseBalanceAtomic === 0n &&
          observation.portfolio.successfulBuyCount === 0n &&
          observation.tickIndex === configuration.entryTickIndex &&
          observation.portfolio.quoteBalanceAtomic >= configuration.buyQuoteAtomic
        ) {
          return { kind: "buy", inputAtomic: configuration.buyQuoteAtomic };
        }
        const peakPrice = observation.portfolio.peakSpotPrice;
        if (observation.portfolio.baseBalanceAtomic === 0n) return { kind: "wait" };
        const drawdownBps = new ExactDecimal(peakPrice.toString())
          .minus(observation.spotPrice)
          .mul("10000")
          .div(peakPrice)
          .floor();
        return drawdownBps.greaterThanOrEqualTo(configuration.drawdownThresholdBps)
          ? sellShare(observation.portfolio.baseBalanceAtomic, configuration.sellShareBps)
          : { kind: "wait" };
      };
    case "random-trader":
      return (observation, random) => {
        const signal = random.nextBelow(10_000n);
        if (signal < configuration.buyProbabilityBps) {
          if (observation.portfolio.quoteBalanceAtomic < configuration.minimumBuyQuoteAtomic) {
            return { kind: "wait" };
          }
          return {
            kind: "buy",
            inputAtomic: chooseBuySize(
              configuration.minimumBuyQuoteAtomic,
              configuration.maximumBuyQuoteAtomic,
              observation.portfolio.quoteBalanceAtomic,
              random,
            ),
          };
        }
        if (
          signal < configuration.buyProbabilityBps + configuration.sellProbabilityBps &&
          observation.portfolio.baseBalanceAtomic > 0n
        ) {
          return sellShare(observation.portfolio.baseBalanceAtomic, configuration.sellShareBps);
        }
        return { kind: "wait" };
      };
  }
}

function validateFunding(configuration: AgentFunding): void {
  if (configuration.id.trim().length === 0) throw new TypeError("Agent id must be non-empty");
  for (const [label, amount] of [
    ["Initial quote balance", configuration.initialQuoteBalanceAtomic],
    ["Initial base balance", configuration.initialBaseBalanceAtomic],
    ["Initial base cost basis", configuration.initialBaseCostBasisQuoteAtomic],
  ] as const) {
    if (typeof amount !== "bigint" || amount < 0n) {
      throw new RangeError(`${label} must be a non-negative atomic bigint`);
    }
    validateU64(amount, label);
  }
  if (
    configuration.initialBaseBalanceAtomic === 0n &&
    configuration.initialBaseCostBasisQuoteAtomic !== 0n
  ) {
    throw new RangeError("Initial base cost basis requires a positive initial base balance");
  }
}

function validateAgentConfiguration(configuration: MvpAgentConfiguration): void {
  switch (configuration.archetype) {
    case "retail-buyer":
      validateBuyRange(configuration.minimumBuyQuoteAtomic, configuration.maximumBuyQuoteAtomic);
      ensureFunded(configuration, configuration.minimumBuyQuoteAtomic, "Retail minimum quote size");
      validateBps(configuration.buyProbabilityBps, "Retail buy probability", false);
      validateBps(configuration.sellProbabilityBps, "Retail sell probability", false);
      validateBps(configuration.sellShareBps, "Retail sell share", true);
      break;
    case "whale":
      validatePositive(configuration.entryTickIndex, "Whale entry tick", true);
      validatePositive(configuration.buyQuoteAtomic, "Whale quote size", false);
      validateU64(configuration.buyQuoteAtomic, "Whale quote size");
      ensureFunded(configuration, configuration.buyQuoteAtomic, "Whale quote size");
      break;
    case "sniper":
      validatePositive(configuration.buyQuoteAtomic, "Sniper quote size", false);
      validateU64(configuration.buyQuoteAtomic, "Sniper quote size");
      validatePositive(configuration.holdTicks, "Sniper hold ticks", false);
      validatePositive(
        configuration.minimumOtherBuyerBaseAtomic,
        "Sniper other-buyer demand",
        false,
      );
      validateU64(configuration.minimumOtherBuyerBaseAtomic, "Sniper other-buyer demand");
      validateBps(configuration.exitShareBps, "Sniper exit share", true);
      ensureFunded(configuration, configuration.buyQuoteAtomic, "Sniper quote size");
      break;
    case "momentum-trader":
      validatePositive(configuration.priceIncreaseThresholdBps, "Momentum threshold", false);
      validatePositive(configuration.buyQuoteAtomic, "Momentum quote size", false);
      validateU64(configuration.buyQuoteAtomic, "Momentum quote size");
      validatePositive(configuration.maximumPurchases, "Momentum maximum purchases", false);
      if (
        configuration.buyQuoteAtomic * configuration.maximumPurchases >
        configuration.initialQuoteBalanceAtomic
      ) {
        throw new RangeError("Momentum quote balance must fund every configured purchase");
      }
      break;
    case "profit-taker":
      validatePositive(configuration.entryTickIndex, "Profit-taker entry tick", true);
      validatePositive(configuration.buyQuoteAtomic, "Profit-taker quote size", false);
      validateU64(configuration.buyQuoteAtomic, "Profit-taker quote size");
      ensureFunded(configuration, configuration.buyQuoteAtomic, "Profit-taker quote size");
      validatePositive(configuration.targetGainBps, "Profit target", false);
      validateBps(configuration.sellShareBps, "Profit-taker sell share", true);
      break;
    case "panic-seller":
      validatePositive(configuration.entryTickIndex, "Panic-seller entry tick", true);
      validatePositive(configuration.buyQuoteAtomic, "Panic-seller quote size", false);
      validateU64(configuration.buyQuoteAtomic, "Panic-seller quote size");
      ensureFunded(configuration, configuration.buyQuoteAtomic, "Panic-seller quote size");
      validateBps(configuration.drawdownThresholdBps, "Panic drawdown threshold", true);
      validateBps(configuration.sellShareBps, "Panic-seller sell share", true);
      break;
    case "random-trader":
      validateBps(configuration.buyProbabilityBps, "Random buy probability", false);
      validateBps(configuration.sellProbabilityBps, "Random sell probability", false);
      if (configuration.buyProbabilityBps + configuration.sellProbabilityBps > 10_000n) {
        throw new RangeError("Random buy and sell probabilities cannot sum above 10000 bps");
      }
      validateBuyRange(configuration.minimumBuyQuoteAtomic, configuration.maximumBuyQuoteAtomic);
      ensureFunded(configuration, configuration.minimumBuyQuoteAtomic, "Random minimum quote size");
      validateBps(configuration.sellShareBps, "Random-trader sell share", true);
      break;
  }
}

function validateBuyRange(minimum: bigint, maximum: bigint): void {
  validatePositive(minimum, "Minimum quote buy size", false);
  validatePositive(maximum, "Maximum quote buy size", false);
  if (maximum < minimum) throw new RangeError("Maximum quote buy size must not be below minimum");
  validateU64(maximum, "Maximum quote buy size");
}

function validateBps(value: bigint, label: string, positive: boolean): void {
  if (typeof value !== "bigint" || value < (positive ? 1n : 0n) || value > 10_000n) {
    throw new RangeError(`${label} must be ${positive ? "1" : "0"} to 10000 basis points`);
  }
}

function validatePositive(value: bigint, label: string, zeroAllowed: boolean): void {
  if (typeof value !== "bigint" || value < (zeroAllowed ? 0n : 1n)) {
    throw new RangeError(`${label} must be a ${zeroAllowed ? "non-negative" : "positive"} bigint`);
  }
}

function ensureFunded(configuration: AgentFunding, amount: bigint, label: string): void {
  if (amount > configuration.initialQuoteBalanceAtomic) {
    throw new RangeError(`${label} exceeds the agent's initial quote balance`);
  }
}

function validateU64(value: bigint, label: string): void {
  if (value > MAX_CURVE_U64) throw new RangeError(`${label} must fit in an unsigned 64-bit amount`);
}

function chooseBuySize(
  minimum: bigint,
  maximum: bigint,
  quoteBalance: bigint,
  random: SeededRandom,
): bigint {
  const boundedMaximum = maximum < quoteBalance ? maximum : quoteBalance;
  return minimum + random.nextBelow(boundedMaximum - minimum + 1n);
}

function sellShare(baseBalance: bigint, shareBps: bigint): SimulationAction {
  const amount = (baseBalance * shareBps) / 10_000n;
  return { kind: "sell", inputAtomic: amount > 0n ? amount : 1n };
}
