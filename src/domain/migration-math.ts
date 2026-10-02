import { type DbcCurve, MAX_CURVE_U64, validateDbcCurveShape } from "./curve.js";
import { quoteRequiredForSegment, sqrtPriceAfterQuoteInput } from "./segment-math.js";

export const MIGRATION_SURPLUS_PARTNER_CREATOR_PERCENT = 80n;
export const MIGRATION_SURPLUS_PROTOCOL_PERCENT = 20n;
export const MIGRATION_PROGRESS_DENOMINATOR_BPS = 10_000n;

export type MigrationQuoteAccounting = Readonly<{
  quoteReserveAtomic: bigint;
  thresholdAtomic: bigint;
  progressBps: bigint;
  curveComplete: boolean;
  overshootAtomic: bigint;
  surplus: Readonly<{
    partnerCreatorAtomic: bigint;
    protocolAtomic: bigint;
  }>;
}>;

export function migrationSqrtPriceAtThreshold(curveInput: DbcCurve): bigint {
  const curve = requireCurve(curveInput);
  let remainingQuote = curve.migrationQuoteThresholdAtomic;
  let currentPrice = curve.startSqrtPriceQ64x64;

  for (const segment of curve.segments) {
    const segmentQuote = quoteRequiredForSegment(segment);
    if (remainingQuote < segmentQuote) {
      return sqrtPriceAfterQuoteInput(currentPrice, segment.liquidity, remainingQuote);
    }
    remainingQuote -= segmentQuote;
    currentPrice = segment.upperSqrtPriceQ64x64;
    if (remainingQuote === 0n) return currentPrice;
  }

  throw new RangeError("Migration quote threshold exceeds the configured curve liquidity");
}

export function calculateMigrationQuoteAccounting(
  quoteReserveAtomic: bigint,
  thresholdAtomic: bigint,
): MigrationQuoteAccounting {
  validateQuoteAmount(quoteReserveAtomic, "Quote reserve");
  validateQuoteAmount(thresholdAtomic, "Migration threshold");
  if (thresholdAtomic === 0n) {
    throw new RangeError("Migration threshold must be greater than zero");
  }

  const curveComplete = quoteReserveAtomic >= thresholdAtomic;
  const overshootAtomic = curveComplete ? quoteReserveAtomic - thresholdAtomic : 0n;
  const partnerCreatorAtomic = (overshootAtomic * MIGRATION_SURPLUS_PARTNER_CREATOR_PERCENT) / 100n;
  const protocolAtomic = overshootAtomic - partnerCreatorAtomic;
  const progressBps = curveComplete
    ? MIGRATION_PROGRESS_DENOMINATOR_BPS
    : (quoteReserveAtomic * MIGRATION_PROGRESS_DENOMINATOR_BPS) / thresholdAtomic;

  return {
    quoteReserveAtomic,
    thresholdAtomic,
    progressBps,
    curveComplete,
    overshootAtomic,
    surplus: { partnerCreatorAtomic, protocolAtomic },
  };
}

function requireCurve(input: DbcCurve): DbcCurve {
  const result = validateDbcCurveShape(input);
  if (result.status === "invalid") {
    throw new RangeError(
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  return result.curve;
}

function validateQuoteAmount(amount: bigint, label: string): void {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_CURVE_U64) {
    throw new RangeError(`${label} must be a non-negative u64 bigint`);
  }
}
