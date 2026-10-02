import { describe, expect, it } from "vitest";
import { createDemoInspectionDocument, formatDemoInspection } from "./inspect.js";
import { serializeCliJson } from "./output.js";

describe("CLI demo inspection", () => {
  it("reports deterministic segment economics and migration outcomes in human units", () => {
    const first = formatDemoInspection();
    const second = formatDemoInspection();

    expect(first).toBe(second);
    expect(first).toContain("Segment economics:");
    expect(first).toContain("1. 0.0002 → 0.00035 USDC/MKT");
    expect(first).toContain("Curve totals: 150000 USDC capital");
    expect(first).toContain("Graduation: 150000 USDC capital target");
    expect(first).toContain("Scripted-run outcome: partial;");
    expect(first).toContain("Migration settlement evidence: unverified");
    expect(first).toContain("Creator 70.00%");
    expect(first).not.toContain("sqrtPriceQ64x64");
    expect(first).not.toContain("Q64.64");
  });

  it("shows raw curve representations only after the advanced heading", () => {
    const report = formatDemoInspection(true);
    const advancedIndex = report.indexOf("Advanced protocol values:");

    expect(advancedIndex).toBeGreaterThan(report.indexOf("DAMM liquidity allocation:"));
    expect(report.slice(0, advancedIndex)).not.toContain("Q64.64");
    expect(report.slice(advancedIndex)).toContain("sqrt price Q64.64");
    expect(report.slice(advancedIndex)).toContain("liquidity");
  });

  it("serializes segment economics and keeps raw protocol fields in the advanced object", () => {
    const economic = JSON.parse(serializeCliJson(createDemoInspectionDocument())) as {
      segments: readonly { quoteCapital: string; baseDistributed: string }[];
      advanced?: unknown;
    };
    const advanced = JSON.parse(serializeCliJson(createDemoInspectionDocument(true))) as {
      advanced: { curve: { segments: readonly { liquidity: string }[] } };
    };

    expect(economic.segments).toHaveLength(3);
    expect(economic.segments[0]).toMatchObject({
      quoteCapital: "25000",
      baseDistributed: "94491118.248527171",
    });
    expect(economic.advanced).toBeUndefined();
    expect(advanced.advanced.curve.segments[0]?.liquidity).toBe(
      "3193812618258873996487382371258889",
    );
  });
});
