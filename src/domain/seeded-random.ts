export const SEEDED_RANDOM_ALGORITHM = "splitmix64-v1";
export const SEEDED_RANDOM_UINT64_RANGE = 1n << 64n;
export const SEEDED_RANDOM_MAX_SEED = SEEDED_RANDOM_UINT64_RANGE - 1n;

const UINT64_MASK = SEEDED_RANDOM_MAX_SEED;
const SPLITMIX64_INCREMENT = 0x9e3779b97f4a7c15n;
const SPLITMIX64_MULTIPLIER_1 = 0xbf58476d1ce4e5b9n;
const SPLITMIX64_MULTIPLIER_2 = 0x94d049bb133111ebn;

export type SeededRandom = Readonly<{
  seed: bigint;
  algorithm: typeof SEEDED_RANDOM_ALGORITHM;
  nextUint64: () => bigint;
  nextBelow: (exclusiveUpperBound: bigint) => bigint;
}>;

export type SeededRunMetadata = Readonly<{
  randomSeed: bigint;
  randomAlgorithm: typeof SEEDED_RANDOM_ALGORITHM;
}>;

export function createSeededRunMetadata(seed: bigint): SeededRunMetadata {
  createSeededRandom(seed);
  return { randomSeed: seed, randomAlgorithm: SEEDED_RANDOM_ALGORITHM };
}

export function createSeededRandom(seed: bigint): SeededRandom {
  if (typeof seed !== "bigint" || seed < 0n || seed > SEEDED_RANDOM_MAX_SEED) {
    throw new RangeError("Random seed must be an unsigned 64-bit bigint");
  }

  let state = seed;
  const nextUint64 = (): bigint => {
    state = (state + SPLITMIX64_INCREMENT) & UINT64_MASK;
    let value = state;
    value = ((value ^ (value >> 30n)) * SPLITMIX64_MULTIPLIER_1) & UINT64_MASK;
    value = ((value ^ (value >> 27n)) * SPLITMIX64_MULTIPLIER_2) & UINT64_MASK;
    return (value ^ (value >> 31n)) & UINT64_MASK;
  };

  const nextBelow = (exclusiveUpperBound: bigint): bigint => {
    if (
      typeof exclusiveUpperBound !== "bigint" ||
      exclusiveUpperBound <= 0n ||
      exclusiveUpperBound > SEEDED_RANDOM_UINT64_RANGE
    ) {
      throw new RangeError("Random upper bound must be a positive value no greater than 2^64");
    }
    const acceptedRange =
      SEEDED_RANDOM_UINT64_RANGE - (SEEDED_RANDOM_UINT64_RANGE % exclusiveUpperBound);
    let value = nextUint64();
    while (value >= acceptedRange) value = nextUint64();
    return value % exclusiveUpperBound;
  };

  return {
    seed,
    algorithm: SEEDED_RANDOM_ALGORITHM,
    nextUint64,
    nextBelow,
  };
}
