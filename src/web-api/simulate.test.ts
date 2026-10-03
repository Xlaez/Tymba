import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileWebDocument } from "./compile.js";
import { simulateWebDocument } from "./simulate.js";

function request() {
  return JSON.parse(
    readFileSync(new URL("../../examples/demo-compile-request.json", import.meta.url), "utf8"),
  );
}
const compileRequest = request();
const candidateId = compileWebDocument(compileRequest).candidates[0]?.id;
const trades = [
  { direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" },
  { direction: "buy", amount: "10000", slot: "2", timestampSeconds: "2" },
  { direction: "sell", amount: "1000000", slot: "3", timestampSeconds: "3" },
];

describe("web deterministic replay", () => {
  it("reproduces buy/sell trades from the exact selected draft with asset-specific fees", () => {
    const input = { compileRequest, candidateId, trades };
    const result = simulateWebDocument(input);
    expect(result.status).toBe("completed");
    expect(result).toEqual(simulateWebDocument(input));
    if (result.status === "failed") return;
    expect(result.trades.map(({ direction }) => direction)).toEqual(["buy", "buy", "sell"]);
    expect(result.inputTrades).toEqual(trades);
    expect(result.metrics.quoteFees).not.toBe("0");
    expect(result.metrics.baseFees).toBe("0");
    expect(result.lifecycle).toBe("bonding");
    expect(result.verificationStatus).toBe("unverified");
    expect(result.randomSeed).toBeNull();
  });
  it("preserves partial fills and does not imply destination migration", () => {
    const result = simulateWebDocument({
      compileRequest,
      candidateId,
      trades: [{ direction: "buy", amount: "200000", slot: "1", timestampSeconds: "1" }],
    });
    expect(result.status).toBe("partial");
    if (result.status === "failed") return;
    expect(result.trades[0]?.status).toBe("partial");
    expect(result.lifecycle).toBe("curve-complete");
    expect(result.metrics.migrationProgressPct).toBe("100");
  });
  it.each([
    { trades: [{ ...trades[0], amount: "0.0000001" }] },
    { trades: [{ ...trades[0], amount: 5000 }] },
    { trades: [trades[1], trades[0]] },
    { candidateId: "not-this-draft", trades },
    { trades: [{ ...trades[0], direction: "sell", amount: "5000" }] },
    { trades: [] },
  ])("reports invalid/unexecutable script without zero-valued success metrics: %j", (override) => {
    const result = simulateWebDocument({ compileRequest, candidateId, ...override });
    expect(result.status).toBe("failed");
    expect(result).not.toHaveProperty("metrics");
  });
});
