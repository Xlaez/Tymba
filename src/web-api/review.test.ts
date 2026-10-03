import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewDocument } from "./review.js";

const marketIntent = JSON.parse(
  readFileSync(new URL("../../examples/demo-market.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("web intent review", () => {
  it("derives exact prices and retains prose as a note, not a constraint", () => {
    const result = reviewDocument({ marketIntent, designNote: "Raise 200k instead" });
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.summary.startPrice).toBe("0.0002");
    expect(result.summary.quoteToMigration).toBe("150000");
    expect(result.designNote).toBe("Raise 200k instead");
    expect(result.intent).toEqual(marketIntent);
  });
  it("does not return interpreted values for invalid or inconsistent input", () => {
    const result = reviewDocument({
      marketIntent: {
        ...marketIntent,
        pricing: { startPrice: "0.0003", startFdv: "200000", migrationFdv: "2000000" },
      },
    });
    expect(result).toMatchObject({
      status: "invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "$.pricing.startPrice", code: "inconsistent_pair" }),
      ]),
    });
    expect(result).not.toHaveProperty("summary");
    expect(reviewDocument({ marketIntent, designNote: "x".repeat(4001) }).status).toBe("invalid");
  });
});
