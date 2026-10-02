import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateMarketIntent } from "../src/domain/market-intent.js";

describe("typed demo market JSON", () => {
  it("parses as the canonical MarketIntent without numeric economic fields", () => {
    const input: unknown = JSON.parse(
      readFileSync(new URL("./demo-market.json", import.meta.url), "utf8"),
    );
    const result = validateMarketIntent(input);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.normalized.startPrice.toString()).toBe("0.0002");
    expect(result.normalized.migrationPrice.toString()).toBe("0.002");
    expect(result.normalized.quoteToMigrationAtomic).toBe(150_000_000_000n);
    expect(result.normalized.targetBaseDistributionBps).toBe(2_500n);
    expect(result.normalized.maxSegments).toBe(3);
  });
});
