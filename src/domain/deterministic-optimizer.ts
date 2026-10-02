import { Decimal } from "decimal.js";

const ExactDecimal = Decimal.clone({
  precision: 512,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100_000,
  toExpPos: 100_000,
});
const DEFAULT_INITIAL_STEP_FRACTION = new ExactDecimal("0.25");
const DEFAULT_MINIMUM_STEP_FRACTION = new ExactDecimal("0.0001");
const DEFAULT_MAX_ITERATIONS = 256;
const MAX_ITERATIONS = 10_000;

export type OptimizationDimension = Readonly<{
  name: string;
  initialValue: Decimal;
  minimum: Decimal;
  maximum: Decimal;
}>;

export type DeterministicCoordinateSearchOptions = Readonly<{
  initialStepFraction?: Decimal;
  minimumStepFraction?: Decimal;
  maxIterations?: number;
}>;

export type OptimizedValue = Readonly<{
  name: string;
  value: Decimal;
}>;

export type DeterministicOptimizationResult = Readonly<{
  values: readonly OptimizedValue[];
  objectiveScore: Decimal;
  iterations: number;
  objectiveEvaluations: number;
}>;

export type DeterministicObjective = (values: readonly Decimal[]) => Decimal;

export function deterministicCoordinateSearch(
  dimensions: readonly OptimizationDimension[],
  objective: DeterministicObjective,
  options: DeterministicCoordinateSearchOptions = {},
): DeterministicOptimizationResult {
  if (!Array.isArray(dimensions)) throw new TypeError("Optimization dimensions must be an array");
  if (typeof objective !== "function") throw new TypeError("Objective must be a function");

  const normalizedDimensions = normalizeDimensions(dimensions);
  const names = new Set<string>();
  for (const dimension of normalizedDimensions) {
    if (names.has(dimension.name))
      throw new TypeError(`Duplicate optimization dimension: ${dimension.name}`);
    names.add(dimension.name);
  }

  const initialStepFraction = normalizeFraction(
    options.initialStepFraction ?? DEFAULT_INITIAL_STEP_FRACTION,
    "Initial step fraction",
  );
  let stepFraction = initialStepFraction;
  const minimumStepFraction = normalizeFraction(
    options.minimumStepFraction ?? DEFAULT_MINIMUM_STEP_FRACTION,
    "Minimum step fraction",
  );
  if (minimumStepFraction.gt(initialStepFraction)) {
    throw new RangeError("Minimum step fraction must not exceed initial step fraction");
  }
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    throw new RangeError(`Maximum iterations must be an integer from 1 to ${MAX_ITERATIONS}`);
  }

  let values = normalizedDimensions.map((dimension) => dimension.initialValue);
  let objectiveEvaluations = 0;
  const evaluate = (candidateValues: readonly Decimal[]): Decimal => {
    const result = objective(Object.freeze([...candidateValues]));
    objectiveEvaluations += 1;
    return decimalValue(result, "Objective result");
  };
  let objectiveScore = evaluate(values);
  let iterations = 0;

  while (
    normalizedDimensions.length > 0 &&
    iterations < maxIterations &&
    stepFraction.gte(minimumStepFraction)
  ) {
    let improvedInPass = false;
    for (let index = 0; index < normalizedDimensions.length; index += 1) {
      const dimension = normalizedDimensions[index];
      const currentValue = values[index];
      if (!dimension || currentValue === undefined) {
        throw new Error("Optimization dimension state is inconsistent");
      }

      const step = dimension.maximum.minus(dimension.minimum).mul(stepFraction);
      let dimensionBestValues = values;
      let dimensionBestScore = objectiveScore;
      for (const direction of [-1, 1] as const) {
        const proposed: Decimal = currentValue.plus(step.mul(direction.toString()));
        const bounded: Decimal = proposed.lt(dimension.minimum)
          ? dimension.minimum
          : proposed.gt(dimension.maximum)
            ? dimension.maximum
            : proposed;
        if (bounded.eq(currentValue)) continue;

        const candidateValues = [...values];
        candidateValues[index] = bounded;
        const candidateScore = evaluate(candidateValues);
        if (candidateScore.lt(dimensionBestScore)) {
          dimensionBestValues = candidateValues;
          dimensionBestScore = candidateScore;
        }
      }

      if (dimensionBestScore.lt(objectiveScore)) {
        values = dimensionBestValues;
        objectiveScore = dimensionBestScore;
        improvedInPass = true;
      }
    }

    if (!improvedInPass) stepFraction = stepFraction.div(2);
    iterations += 1;
  }

  return {
    values: normalizedDimensions.map((dimension, index) => {
      const value = values[index];
      if (value === undefined) throw new Error("Optimized value is missing");
      return { name: dimension.name, value };
    }),
    objectiveScore,
    iterations,
    objectiveEvaluations,
  };
}

function normalizeDimensions(dimensions: readonly OptimizationDimension[]): readonly Readonly<{
  name: string;
  initialValue: Decimal;
  minimum: Decimal;
  maximum: Decimal;
}>[] {
  return dimensions.map((dimension, index) => {
    if (typeof dimension !== "object" || dimension === null) {
      throw new TypeError(`Optimization dimension ${index} must be an object`);
    }
    if (typeof dimension.name !== "string" || !dimension.name.trim()) {
      throw new TypeError(`Optimization dimension ${index} must have a name`);
    }
    const initialValue = decimalValue(dimension.initialValue, `${dimension.name} initial value`);
    const minimum = decimalValue(dimension.minimum, `${dimension.name} minimum`);
    const maximum = decimalValue(dimension.maximum, `${dimension.name} maximum`);
    if (!maximum.gt(minimum)) {
      throw new RangeError(`${dimension.name} maximum must be greater than its minimum`);
    }
    if (initialValue.lt(minimum) || initialValue.gt(maximum)) {
      throw new RangeError(`${dimension.name} initial value must be within its bounds`);
    }
    return { name: dimension.name.trim(), initialValue, minimum, maximum };
  });
}

function normalizeFraction(value: Decimal, label: string): Decimal {
  const fraction = decimalValue(value, label);
  if (!fraction.gt(0) || fraction.gt(1)) {
    throw new RangeError(`${label} must be greater than zero and no more than one`);
  }
  return fraction;
}

function decimalValue(value: Decimal, label: string): Decimal {
  if (!Decimal.isDecimal(value)) throw new TypeError(`${label} must be a decimal value`);
  const decimal = new ExactDecimal(value.toFixed());
  if (!decimal.isFinite()) throw new RangeError(`${label} must be finite`);
  return decimal;
}
