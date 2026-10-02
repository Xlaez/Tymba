import type { ValidationStatus } from "./status.js";

export const MAX_PUBLIC_BUILDER_CURVE_ENTRIES = 16;
export const MAX_PUBLIC_BUILDER_SEGMENTS = MAX_PUBLIC_BUILDER_CURVE_ENTRIES;
export const MAX_PUBLIC_BUILDER_SQRT_PRICE_BOUNDARIES = MAX_PUBLIC_BUILDER_SEGMENTS + 1;
export const MAX_CURVE_U64 = (1n << 64n) - 1n;
export const MAX_CURVE_U128 = (1n << 128n) - 1n;

export type CurveSegment = Readonly<{
  lowerSqrtPriceQ64x64: bigint;
  upperSqrtPriceQ64x64: bigint;
  liquidity: bigint;
}>;

export type DbcCurve = Readonly<{
  baseDecimals: number;
  quoteDecimals: number;
  startSqrtPriceQ64x64: bigint;
  migrationQuoteThresholdAtomic: bigint;
  segments: readonly CurveSegment[];
}>;

export type CurveShapeIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type CurveShapeValidationResult =
  | Readonly<{ status: Extract<ValidationStatus, "valid">; curve: DbcCurve }>
  | Readonly<{
      status: Extract<ValidationStatus, "invalid">;
      issues: readonly CurveShapeIssue[];
    }>;

type UnknownRecord = Record<string, unknown>;

export function validateDbcCurveShape(input: unknown): CurveShapeValidationResult {
  const issues: CurveShapeIssue[] = [];
  if (!isRecord(input)) {
    return {
      status: "invalid",
      issues: [{ path: "$", code: "invalid_object", message: "Expected a curve object" }],
    };
  }

  checkKeys(
    input,
    [
      "baseDecimals",
      "quoteDecimals",
      "startSqrtPriceQ64x64",
      "migrationQuoteThresholdAtomic",
      "segments",
    ],
    "$",
    issues,
  );

  const baseDecimals = input.baseDecimals;
  if (
    typeof baseDecimals !== "number" ||
    !Number.isInteger(baseDecimals) ||
    baseDecimals < 6 ||
    baseDecimals > 9
  ) {
    addIssue(issues, "$.baseDecimals", "out_of_range", "Must be an integer from 6 to 9");
  }

  const quoteDecimals = input.quoteDecimals;
  if (
    typeof quoteDecimals !== "number" ||
    !Number.isInteger(quoteDecimals) ||
    quoteDecimals < 0 ||
    quoteDecimals > 255
  ) {
    addIssue(issues, "$.quoteDecimals", "out_of_range", "Must be an integer from 0 to 255");
  }

  const startSqrtPriceQ64x64 = readBigint(
    input.startSqrtPriceQ64x64,
    "$.startSqrtPriceQ64x64",
    issues,
  );
  checkU128(startSqrtPriceQ64x64, "$.startSqrtPriceQ64x64", "Sqrt price", issues);

  const migrationQuoteThresholdAtomic = readBigint(
    input.migrationQuoteThresholdAtomic,
    "$.migrationQuoteThresholdAtomic",
    issues,
  );
  if (
    migrationQuoteThresholdAtomic !== undefined &&
    (migrationQuoteThresholdAtomic <= 0n || migrationQuoteThresholdAtomic > MAX_CURVE_U64)
  ) {
    addIssue(
      issues,
      "$.migrationQuoteThresholdAtomic",
      "out_of_range",
      "Must be a positive u64 atomic quote amount",
    );
  }

  const segmentsInput = input.segments;
  const segments: CurveSegment[] = [];
  if (!Array.isArray(segmentsInput)) {
    addIssue(issues, "$.segments", "invalid_array", "Expected an array of curve segments");
  } else {
    if (segmentsInput.length < 1 || segmentsInput.length > MAX_PUBLIC_BUILDER_SEGMENTS) {
      addIssue(
        issues,
        "$.segments",
        "segment_count",
        `Must contain between 1 and ${MAX_PUBLIC_BUILDER_SEGMENTS} public-builder curve entries/segments`,
      );
    }
    for (const [index, value] of segmentsInput.entries()) {
      const path = `$.segments[${index}]`;
      if (!isRecord(value)) {
        addIssue(issues, path, "invalid_object", "Expected a segment object");
        continue;
      }
      checkKeys(value, ["lowerSqrtPriceQ64x64", "upperSqrtPriceQ64x64", "liquidity"], path, issues);
      const lowerSqrtPriceQ64x64 = readBigint(
        value.lowerSqrtPriceQ64x64,
        `${path}.lowerSqrtPriceQ64x64`,
        issues,
      );
      const upperSqrtPriceQ64x64 = readBigint(
        value.upperSqrtPriceQ64x64,
        `${path}.upperSqrtPriceQ64x64`,
        issues,
      );
      const liquidity = readBigint(value.liquidity, `${path}.liquidity`, issues);
      checkU128(lowerSqrtPriceQ64x64, `${path}.lowerSqrtPriceQ64x64`, "Sqrt price", issues);
      checkU128(upperSqrtPriceQ64x64, `${path}.upperSqrtPriceQ64x64`, "Sqrt price", issues);
      if (liquidity !== undefined && (liquidity <= 0n || liquidity > MAX_CURVE_U128)) {
        addIssue(
          issues,
          `${path}.liquidity`,
          "out_of_range",
          "Must be a positive u128 liquidity value",
        );
      }
      if (
        lowerSqrtPriceQ64x64 !== undefined &&
        upperSqrtPriceQ64x64 !== undefined &&
        upperSqrtPriceQ64x64 <= lowerSqrtPriceQ64x64
      ) {
        addIssue(
          issues,
          `${path}.upperSqrtPriceQ64x64`,
          "non_increasing_price",
          "Upper sqrt price must be greater than lower sqrt price",
        );
      }
      if (
        lowerSqrtPriceQ64x64 !== undefined &&
        upperSqrtPriceQ64x64 !== undefined &&
        liquidity !== undefined
      ) {
        segments.push({ lowerSqrtPriceQ64x64, upperSqrtPriceQ64x64, liquidity });
      }
    }
  }

  if (
    startSqrtPriceQ64x64 !== undefined &&
    segments[0]?.lowerSqrtPriceQ64x64 !== startSqrtPriceQ64x64
  ) {
    addIssue(
      issues,
      "$.segments[0].lowerSqrtPriceQ64x64",
      "start_price_mismatch",
      "The first segment must start at the curve start sqrt price",
    );
  }

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (previous && current && current.lowerSqrtPriceQ64x64 !== previous.upperSqrtPriceQ64x64) {
      addIssue(
        issues,
        `$.segments[${index}].lowerSqrtPriceQ64x64`,
        "segment_gap_or_overlap",
        "Each segment must begin at the preceding segment's upper sqrt price",
      );
    }
  }

  if (issues.length > 0) return { status: "invalid", issues };
  if (
    typeof baseDecimals !== "number" ||
    typeof quoteDecimals !== "number" ||
    startSqrtPriceQ64x64 === undefined ||
    migrationQuoteThresholdAtomic === undefined
  ) {
    return {
      status: "invalid",
      issues: [{ path: "$", code: "invalid_curve", message: "Curve could not be validated" }],
    };
  }

  return {
    status: "valid",
    curve: {
      baseDecimals,
      quoteDecimals,
      startSqrtPriceQ64x64,
      migrationQuoteThresholdAtomic,
      segments,
    },
  };
}

function readBigint(value: unknown, path: string, issues: CurveShapeIssue[]): bigint | undefined {
  if (typeof value !== "bigint") {
    addIssue(issues, path, "invalid_integer", "Expected a bigint protocol value");
    return undefined;
  }
  return value;
}

function checkU128(
  value: bigint | undefined,
  path: string,
  label: string,
  issues: CurveShapeIssue[],
): void {
  if (value !== undefined && (value <= 0n || value > MAX_CURVE_U128)) {
    addIssue(issues, path, "out_of_range", `${label} must be a positive u128 value`);
  }
}

function checkKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: CurveShapeIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      addIssue(issues, `${path}.${key}`, "unknown_field", "Field is not supported");
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: CurveShapeIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}
