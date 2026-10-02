import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatValidationReport, validateDocuments } from "./validate.js";

function readExample(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("CLI document validation", () => {
  it("validates the demo intent and optional fee and migration configurations", () => {
    const report = validateDocuments(
      readExample("demo-market.json"),
      readExample("demo-fees.json"),
      readExample("demo-migration.json"),
    );

    expect(report.status).toBe("valid");
    expect(report.intentStatus).toBe("valid");
    expect(report.configurations).toEqual({ fees: "valid", migration: "valid" });
    expect(report.summary).toEqual({
      market: "MKT/USDC",
      totalBase: "1000000000",
      startPrice: "0.0002",
      startFdv: "200000",
      migrationPrice: "0.002",
      migrationFdv: "2000000",
      quoteToMigration: "150000",
      baseDistributionPct: "25",
      maxSegments: 3,
    });
    expect(formatValidationReport(report)).toContain(
      "Capital target before graduation: 150000 USDC",
    );
  });

  it("reports field paths and rejects numeric protocol integers", () => {
    const fees = readExample("demo-fees.json") as Record<string, unknown>;
    const base = fees.base as Record<string, unknown>;
    const report = validateDocuments(readExample("demo-market.json"), {
      ...fees,
      base: { ...base, startingFeeBps: 1000 },
    });

    expect(report.status).toBe("invalid");
    expect(report.configurations.fees).toBe("invalid");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "$.fees.base.startingFeeBps",
        code: "invalid_integer_string",
      }),
    );
  });

  it("does not report valid when the intent is invalid", () => {
    const intent = readExample("demo-market.json") as {
      supply: { totalBase: string };
    };
    const report = validateDocuments({ ...intent, supply: { totalBase: 1_000_000_000 } });

    expect(report.status).toBe("invalid");
    expect(report.intentStatus).toBe("invalid");
    expect(report.configurations).toEqual({ fees: "not-provided", migration: "not-provided" });
    expect(report.issues).toContainEqual(
      expect.objectContaining({ path: "$.supply.totalBase", code: "invalid_decimal" }),
    );
  });
});
