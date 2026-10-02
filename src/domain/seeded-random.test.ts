import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  createSeededRunMetadata,
  SEEDED_RANDOM_ALGORITHM,
  SEEDED_RANDOM_MAX_SEED,
  SEEDED_RANDOM_UINT64_RANGE,
} from "./seeded-random.js";

describe("seeded random generator", () => {
  it("replays the same SplitMix64 sequence from the recorded seed", () => {
    const first = createSeededRandom(0n);
    const replay = createSeededRandom(0n);

    expect(first.algorithm).toBe(SEEDED_RANDOM_ALGORITHM);
    expect(first.seed).toBe(0n);
    expect(Array.from({ length: 6 }, () => first.nextUint64())).toEqual(
      Array.from({ length: 6 }, () => replay.nextUint64()),
    );
  });

  it("supports the complete unsigned 64-bit seed and output ranges", () => {
    const random = createSeededRandom(SEEDED_RANDOM_MAX_SEED);

    for (let index = 0; index < 32; index += 1) {
      const value = random.nextUint64();
      expect(value).toBeGreaterThanOrEqual(0n);
      expect(value).toBeLessThan(SEEDED_RANDOM_UINT64_RANGE);
    }
  });

  it("persists the exact seed and algorithm identifier in run metadata", () => {
    expect(createSeededRunMetadata(123n)).toEqual({
      randomSeed: 123n,
      randomAlgorithm: SEEDED_RANDOM_ALGORITHM,
    });
    expect(() => createSeededRunMetadata(-1n)).toThrow("unsigned 64-bit bigint");
  });

  it("returns unbiased bounded values within the requested exclusive bound", () => {
    const random = createSeededRandom(42n);

    for (const upperBound of [1n, 3n, 10_000n, SEEDED_RANDOM_UINT64_RANGE]) {
      for (let index = 0; index < 64; index += 1) {
        const value = random.nextBelow(upperBound);
        expect(value).toBeGreaterThanOrEqual(0n);
        expect(value).toBeLessThan(upperBound);
      }
    }
  });

  it("rejects invalid seeds and bounds instead of silently coercing them", () => {
    expect(() => createSeededRandom(-1n)).toThrow("unsigned 64-bit bigint");
    expect(() => createSeededRandom(SEEDED_RANDOM_UINT64_RANGE)).toThrow("unsigned 64-bit bigint");

    const random = createSeededRandom(1n);
    expect(() => random.nextBelow(0n)).toThrow("positive value");
    expect(() => random.nextBelow(SEEDED_RANDOM_UINT64_RANGE + 1n)).toThrow("positive value");
  });
});
