import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { formatAttackDocument, runAttackDocument } from "./attack.js";
import { runCli } from "./index.js";

function readExample(): unknown {
  return JSON.parse(
    readFileSync(new URL("../../examples/demo-attack-request.json", import.meta.url), "utf8"),
  ) as unknown;
}

describe("CLI attack request", () => {
  it("compiles one curve draft and runs a seeded opening-sniper attack against it", () => {
    const document = runAttackDocument(readExample(), "sniper");

    expect(document.status).toBe("completed");
    expect(document.scenario).toBe("opening-sniper");
    expect(document.candidate?.kind).toBe("curve-draft");
    expect(document.candidate?.verificationStatus).toBe("unverified");
    expect(document.evidence.note).toContain("not a deployable candidate");
    expect(document.assumptions).toMatchObject({
      marketIntent: { assets: { base: { symbol: "MKT" }, quote: { symbol: "USDC" } } },
      attack: { id: "demo-opening-sniper" },
      preScenarioBuyQuoteAtomic: "10000000000",
    });
    if (document.result?.scenario !== "opening-sniper") {
      throw new Error("Expected opening-sniper result");
    }
    expect(document.result.completedIterations).toBe(1n);
    expect(formatAttackDocument(document)).toContain("full verification pending");
  });

  it("rejects numeric economic protocol fields and unknown scenario configuration", () => {
    const request = readExample() as {
      attacks: { "opening-sniper": { randomSeed: string } };
    };
    expect(() =>
      runAttackDocument(
        {
          ...request,
          attacks: {
            ...request.attacks,
            "opening-sniper": { ...request.attacks["opening-sniper"], randomSeed: 73 },
          },
        },
        "sniper",
      ),
    ).toThrow("unsigned integer decimal string");
    expect(() => runAttackDocument(readExample(), "not-an-attack")).toThrow(
      "Unsupported attack scenario",
    );
    expect(() =>
      runAttackDocument(
        {
          ...(readExample() as Record<string, unknown>),
          attacks: { "opening-sniper": {}, typo: {} },
        },
        "sniper",
      ),
    ).toThrow("attacks contains unsupported field typo");
  });

  it("supports the documented tymba attack file and scenario command", async () => {
    let output = "";
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);

    const exitCode = await runCli([
      "attack",
      "examples/demo-attack-request.json",
      "--scenario",
      "sniper",
      "--json",
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      command: "attack",
      scenario: "opening-sniper",
      candidate: { kind: "curve-draft", verificationStatus: "unverified" },
    });
    expect(stderr).not.toHaveBeenCalled();
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("runs all five attacks against the same compiled curve draft", () => {
    const request = readExample();
    const scenarios = [
      "opening-sniper",
      "whale-entry",
      "pump-and-dump",
      "sell-cascade",
      "fee-schedule-timing",
    ] as const;
    const documents = scenarios.map((scenario) => runAttackDocument(request, scenario));

    expect(
      documents.map(({ scenario, status, failure }) => ({ scenario, status, failure })),
    ).toEqual(scenarios.map((scenario) => ({ scenario, status: "completed", failure: undefined })));
    expect(new Set(documents.map(({ candidate }) => candidate?.id)).size).toBe(1);
    for (const [index, document] of documents.entries()) {
      expect(document.scenario).toBe(scenarios[index]);
      expect(document.candidate).toMatchObject({
        kind: "curve-draft",
        verificationStatus: "unverified",
      });
      expect(document.evidence.classification).toBe("modeled");
      expect(document.assumptions).toMatchObject({
        marketIntent: {},
        objectiveWeights: {},
        simulation: {},
        attack: {},
      });
      expect(document.result).toBeDefined();
    }

    const firstSniper = documents[0];
    const replay = runAttackDocument(request, "opening-sniper");
    expect(replay.result).toEqual(firstSniper?.result);
  });
});
