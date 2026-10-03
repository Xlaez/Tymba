import demoRequest from "../../examples/demo-compile-request.json" with { type: "json" };

export const demoConfiguration = {
  objectiveWeights: demoRequest.objectiveWeights,
  simulation: demoRequest.simulation,
};

export const initialDescribeFields = {
  baseSymbol: demoRequest.marketIntent.assets.base.symbol,
  baseDecimals: String(demoRequest.marketIntent.assets.base.decimals),
  baseMint: "",
  quoteSymbol: demoRequest.marketIntent.assets.quote.symbol,
  quoteDecimals: String(demoRequest.marketIntent.assets.quote.decimals),
  quoteMint: "",
  totalBase: demoRequest.marketIntent.supply.totalBase,
  startFdv: demoRequest.marketIntent.pricing.startFdv,
  startPrice: "",
  migrationFdv: demoRequest.marketIntent.pricing.migrationFdv,
  migrationPrice: "",
  quoteToMigration: demoRequest.marketIntent.targets.quoteToMigration,
  baseDistributionPct: demoRequest.marketIntent.targets.baseDistributionPct,
  launchProfile: demoRequest.marketIntent.preferences.launchProfile,
  sniperResistance: demoRequest.marketIntent.preferences.sniperResistance,
  maxEarlyPriceImpactPct: "",
  earlyBuyerAdvantagePct: "",
  maxSegments: String(demoRequest.marketIntent.solver.maxSegments),
  creatorLockedPct: "",
  partnerLockedPct: "",
  unlockedPct: "",
  lockDurationSeconds: "",
};

export type DescribeFields = typeof initialDescribeFields;

export function describeIntent(fields: DescribeFields): unknown {
  const migration = optionalFields(fields, [
    "creatorLockedPct",
    "partnerLockedPct",
    "unlockedPct",
    "lockDurationSeconds",
  ]);
  return {
    assets: {
      base: {
        symbol: fields.baseSymbol,
        decimals: structuralInteger(fields.baseDecimals),
        ...(fields.baseMint ? { mint: fields.baseMint } : {}),
      },
      quote: {
        symbol: fields.quoteSymbol,
        decimals: structuralInteger(fields.quoteDecimals),
        ...(fields.quoteMint ? { mint: fields.quoteMint } : {}),
      },
    },
    supply: { totalBase: fields.totalBase },
    pricing: optionalFields(fields, ["startFdv", "startPrice", "migrationFdv", "migrationPrice"]),
    targets: optionalFields(fields, ["quoteToMigration", "baseDistributionPct"]),
    preferences: optionalFields(fields, [
      "launchProfile",
      "sniperResistance",
      "maxEarlyPriceImpactPct",
      "earlyBuyerAdvantagePct",
    ]),
    solver: { maxSegments: structuralInteger(fields.maxSegments) },
    ...(Object.keys(migration).length ? { migration } : {}),
  };
}

function structuralInteger(value: string): number | string {
  return /^(?:0|[1-9]\d{0,2})$/.test(value) ? Number(value) : value;
}

function optionalFields(fields: DescribeFields, keys: readonly (keyof DescribeFields)[]) {
  return Object.fromEntries(
    keys.filter((key) => fields[key] !== "").map((key) => [key, fields[key]]),
  );
}
