import { describe, expect, it } from "vitest";
import { runDemoSimulation } from "../../examples/demo-market.js";
import { serializeCliJson } from "./output.js";
import { createSimulationDocument, formatSimulationReport } from "./simulate.js";

describe("CLI deterministic simulation report", () => {
  it("formats the scripted run reproducibly in economic units", () => {
    const first = formatSimulationReport(runDemoSimulation());
    const second = formatSimulationReport(runDemoSimulation());

    expect(first).toBe(second);
    expect(first).toContain("Capital accumulated before migration: 150000 USDC");
    expect(first).toContain("Graduation fully diluted value: 2000000 USDC");
    expect(first).toContain("Post-migration liquidity shares: Creator 70.00%");
    expect(first).toContain("illustrative migration settlement is unverified");
    expect(first).not.toContain("sqrtPriceQ64x64");
    expect(first).not.toContain("liquidity units:");
  });

  it("places exact protocol representations in a trailing advanced section", () => {
    const report = formatSimulationReport(runDemoSimulation(), true);
    const advancedIndex = report.indexOf("Advanced protocol values:");

    expect(advancedIndex).toBeGreaterThan(report.indexOf("Trade details:"));
    expect(report.slice(0, advancedIndex)).not.toContain("Q64.64");
    expect(report.slice(advancedIndex)).toContain("sqrt price Q64.64");
    expect(report.slice(advancedIndex)).toContain("atomic");
  });

  it("provides stable economic JSON and nests exact internal state under advanced", () => {
    const result = runDemoSimulation();
    const economicDocument = JSON.parse(serializeCliJson(createSimulationDocument(result))) as {
      metrics: { capitalAccumulatedBeforeMigration: { amount: string; asset: string } };
      advanced?: unknown;
    };
    const advancedDocument = JSON.parse(
      serializeCliJson(createSimulationDocument(result, true)),
    ) as {
      advanced: {
        simulation: { initialState: { curve: { migrationQuoteThresholdAtomic: string } } };
      };
    };

    expect(economicDocument.metrics.capitalAccumulatedBeforeMigration).toEqual({
      amount: "150000",
      asset: "USDC",
    });
    expect(economicDocument.advanced).toBeUndefined();
    expect(
      advancedDocument.advanced.simulation.initialState.curve.migrationQuoteThresholdAtomic,
    ).toBe("150000000000");
  });
});
