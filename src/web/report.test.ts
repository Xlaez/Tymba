import { describe, expect, it } from "vitest";
import attackFixture from "../../examples/demo-attack-request.json" with { type: "json" };
import compileFixture from "../../examples/demo-compile-request.json" with { type: "json" };
import { auditWebDocument } from "../web-api/audit.js";
import { compileWebDocument } from "../web-api/compile.js";
import type { WebAuditRequest, WebAuditResponse } from "../web-api/contracts.js";
import { createMarketAuditReport, serializeMarketAuditReport } from "./report.js";

describe("versioned market audit report", { timeout: 20_000 }, () => {
  it("retains intent, solver and candidate data, run seeds, findings, and source evidence reproducibly", () => {
    const compilation = compileWebDocument(compileFixture);
    const candidate = compilation.candidates[0];
    if (!candidate) throw new Error("The demo compile did not produce a draft.");
    const request: WebAuditRequest = {
      compileRequest: compileFixture,
      candidateId: candidate.id,
      trades: [{ direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" }],
      attacks: [
        {
          compileRequest: compileFixture,
          candidateId: candidate.id,
          scenario: "opening-sniper",
          configuration: attackFixture.attacks["opening-sniper"],
        },
      ],
    };
    const audit = auditWebDocument(request);
    if (audit.status === "failed") throw new Error(audit.message);
    const report = createMarketAuditReport({ request, compilation, candidate, audit });
    const repeatedCompilation = compileWebDocument(compileFixture);
    const repeatedCandidate = repeatedCompilation.candidates[0];
    if (!repeatedCandidate) throw new Error("The repeated demo compile did not produce a draft.");
    const repeatedAudit = auditWebDocument(request);
    if (repeatedAudit.status === "failed") throw new Error(repeatedAudit.message);
    const repeated = createMarketAuditReport({
      request,
      compilation: repeatedCompilation,
      candidate: repeatedCandidate,
      audit: repeatedAudit,
    });

    expect(report).toMatchObject({
      reportType: "tymba.market-audit-report",
      schemaVersion: 1,
      evidenceClassification: "modeled",
      verificationStatus: "unverified",
      input: { marketIntent: compileFixture.marketIntent },
      solver: {
        engineVersion: compilation.engineVersion,
        algorithmVersion: compilation.algorithmVersion,
        sdkVersion: compilation.sdkVersion,
      },
      candidate: {
        id: candidate.id,
        parameters: candidate.advanced,
      },
      reproducibility: {
        deterministicRun: { randomSeed: null },
        attacks: [
          {
            scenario: "opening-sniper",
            seedPolicy: "splitmix64-v1",
            masterSeed: "73",
            iterationSeeds: [expect.any(String)],
          },
        ],
      },
      audit: {
        status: audit.status,
        policy: audit.policy,
        categories: audit.categories,
        sourceEvidence: audit.snapshot,
      },
    });
    expect(repeatedCompilation).toEqual(compilation);
    expect(serializeMarketAuditReport(report)).toBe(serializeMarketAuditReport(repeated));
    expect(report.audit.categories).toEqual(expect.arrayContaining([expect.any(Object)]));
  });

  it("excludes private or signing material fields while retaining reproducibility seeds", () => {
    const compilation = compileWebDocument(compileFixture);
    const candidate = compilation.candidates[0];
    if (!candidate) throw new Error("The demo compile did not produce a draft.");
    const request: WebAuditRequest = {
      compileRequest: compileFixture,
      candidateId: candidate.id,
      attacks: [],
    };
    const audit = auditWebDocument(request);
    if (audit.status === "failed") throw new Error(audit.message);
    const contaminated = {
      ...audit,
      snapshot: {
        ...(audit.snapshot as Record<string, unknown>),
        privateKey: "private-value",
        walletSigningMaterial: "signing-value",
        nested: {
          apiSecret: "secret-value",
          apiKey: "api-key-value",
          credentials: "credential-value",
          accessToken: "access-token-value",
          randomSeed: "73",
        },
      },
    } as WebAuditResponse;
    if (contaminated.status === "failed") throw new Error(contaminated.message);
    const report = createMarketAuditReport({
      request,
      compilation,
      candidate,
      audit: contaminated,
    });
    const serialized = serializeMarketAuditReport(report);

    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("walletSigningMaterial");
    expect(serialized).not.toContain("apiSecret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("credentials");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("signing-value");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("api-key-value");
    expect(serialized).not.toContain("credential-value");
    expect(serialized).not.toContain("access-token-value");
    expect(serialized).toContain('"randomSeed": "73"');
  });
});
