import type {
  JsonValue,
  WebAuditRequest,
  WebAuditResponse,
  WebCompileResponse,
  WebDraftCandidate,
} from "../web-api/contracts.js";

export type MarketAuditReportV1 = Readonly<{
  reportType: "tymba.market-audit-report";
  schemaVersion: 1;
  evidenceClassification: "modeled";
  verificationStatus: "unverified";
  input: Readonly<{
    marketIntent: JsonValue;
    objectiveWeights: JsonValue;
    simulation: JsonValue;
    deterministicTrades: readonly JsonValue[];
    attacks: readonly JsonValue[];
  }>;
  solver: Readonly<{
    status: WebCompileResponse["status"];
    solverStatus?: WebCompileResponse["solverStatus"];
    engineVersion: string;
    algorithmVersion: string;
    sdkVersion: string;
  }>;
  candidate: Readonly<{
    id: string;
    rank: number;
    objectiveScore: string;
    metrics: Readonly<{
      quoteToMigration: string;
      baseDistributed: string;
      baseDistributionPct: string;
      migrationPrice: string;
      migrationFdv: string;
    }>;
    parameters: NonNullable<WebDraftCandidate["advanced"]>;
  }>;
  reproducibility: Readonly<{
    deterministicRun: Readonly<{
      id: string;
      randomSeed: null;
      seedPolicy: "not-applicable-deterministic-run";
    }>;
    attacks: readonly Readonly<{
      scenario: string;
      seedPolicy: "splitmix64-v1" | "not-applicable-deterministic-sweep";
      masterSeed: string | null;
      iterationSeeds: readonly string[];
    }>[];
  }>;
  audit: Readonly<{
    status: Exclude<WebAuditResponse["status"], "failed">;
    policy: JsonValue;
    categories: readonly JsonValue[];
    sourceEvidence: JsonValue;
  }>;
}>;

export function createMarketAuditReport(input: {
  request: WebAuditRequest;
  compilation: WebCompileResponse;
  candidate: WebDraftCandidate;
  audit: Exclude<WebAuditResponse, { status: "failed" }>;
}): MarketAuditReportV1 {
  const { request, compilation, candidate, audit } = input;
  if (
    candidate.id !== request.candidateId ||
    candidate.id !== audit.candidateId ||
    candidate.advanced?.candidateId !== candidate.id
  )
    throw new RangeError("The report inputs must describe the same selected candidate.");
  const compileRequest = requireRecord(request.compileRequest, "compile request");
  const marketIntent = toJsonValue(compileRequest.marketIntent);
  const objectiveWeights = toJsonValue(compileRequest.objectiveWeights);
  const simulation = toJsonValue(compileRequest.simulation);
  const sourceEvidence = toJsonValue(audit.snapshot);
  const evidenceAttacks = readEvidenceAttacks(sourceEvidence, request.attacks.length);
  const attacks = request.attacks.map((attack, index) => {
    const configuration = requireRecord(attack.configuration, "attack configuration");
    const scenario = attack.scenario;
    const deterministicSweep = scenario === "fee-schedule-timing";
    const source = requireRecord(evidenceAttacks[index], "attack evidence");
    const attackDocument = requireRecord(source.snapshot, "attack source snapshot");
    const result = isRecord(attackDocument.result) ? attackDocument.result : {};
    const iterationSeeds = Array.isArray(result.iterationOutcomes)
      ? result.iterationOutcomes.flatMap((outcome) =>
          isRecord(outcome) && typeof outcome.randomSeed === "string" ? [outcome.randomSeed] : [],
        )
      : [];
    const masterSeed = deterministicSweep
      ? null
      : typeof result.randomSeed === "string"
        ? result.randomSeed
        : typeof configuration.randomSeed === "string"
          ? configuration.randomSeed
          : null;
    return {
      scenario,
      seedPolicy: deterministicSweep
        ? ("not-applicable-deterministic-sweep" as const)
        : ("splitmix64-v1" as const),
      masterSeed,
      iterationSeeds,
    };
  });
  const report = {
    reportType: "tymba.market-audit-report" as const,
    schemaVersion: 1 as const,
    evidenceClassification: "modeled" as const,
    verificationStatus: candidate.verificationStatus,
    input: {
      marketIntent,
      objectiveWeights,
      simulation,
      deterministicTrades: (request.trades ?? []).map(toJsonValue),
      attacks: request.attacks.map((attack) => toJsonValue(attack)),
    },
    solver: {
      status: compilation.status,
      ...(compilation.solverStatus === undefined ? {} : { solverStatus: compilation.solverStatus }),
      engineVersion: compilation.engineVersion,
      algorithmVersion: compilation.algorithmVersion,
      sdkVersion: compilation.sdkVersion,
    },
    candidate: {
      id: candidate.id,
      rank: candidate.rank,
      objectiveScore: candidate.objectiveScore,
      metrics: {
        quoteToMigration: candidate.quoteToMigration,
        baseDistributed: candidate.baseDistributed,
        baseDistributionPct: candidate.baseDistributionPct,
        migrationPrice: candidate.migrationPrice,
        migrationFdv: candidate.migrationFdv,
      },
      parameters: candidate.advanced,
    },
    reproducibility: {
      deterministicRun: {
        id: candidate.simulationId,
        randomSeed: null,
        seedPolicy: "not-applicable-deterministic-run" as const,
      },
      attacks,
    },
    audit: {
      status: audit.status,
      policy: toJsonValue(audit.policy),
      categories: audit.categories.map(toJsonValue),
      sourceEvidence,
    },
  };
  return redactSensitiveFields(report) as MarketAuditReportV1;
}

export function serializeMarketAuditReport(report: MarketAuditReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function marketAuditReportFilename(candidateId: string): string {
  const safeId = candidateId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || "market";
  return `tymba-audit-report-${safeId}-v1.json`;
}

function readEvidenceAttacks(value: JsonValue, expectedCount: number): readonly JsonValue[] {
  if (!isRecord(value) || !Array.isArray(value.attacks) || value.attacks.length !== expectedCount)
    throw new RangeError("The audit report is missing retained attack evidence.");
  return value.attacks;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`The report ${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("The report cannot contain non-finite numbers.");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  throw new TypeError("The report contains a value that cannot be represented as JSON.");
}

function redactSensitiveFields(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("The report cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (!isRecord(value)) throw new TypeError("The report contains a non-JSON value.");
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:private[_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token|credential|secret|mnemonic|seed[_-]?phrase|signer|keypair|signing[_-]?material)/i.test(
            key,
          ),
      )
      .map(([key, entry]) => [key, redactSensitiveFields(entry)]),
  );
}
