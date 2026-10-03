import { readFileSync } from "node:fs";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  buildCandidate,
  buildDemoV1MarketTransaction,
  DEMO_V1_METADATA_URI_PLACEHOLDER,
  prepareDeployment,
  resolveCandidateAuthority,
  resolveCandidateMetadata,
  resolveCandidateSdkConfig,
  sendDeployment,
  serializeDeploymentCandidate,
} from "./deployment-candidate.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";

const WALLET = Keypair.fromSeed(new Uint8Array(32).fill(31));
const OTHER_WALLET = Keypair.fromSeed(new Uint8Array(32).fill(34));
const CONFIG = Keypair.fromSeed(new Uint8Array(32).fill(32)).publicKey;
const BASE_MINT = Keypair.fromSeed(new Uint8Array(32).fill(33)).publicKey;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const METADATA_URI = "https://metadata.invalid/tymba-devnet-demo.json";
const MESSAGE_DIGEST = "a".repeat(64);

function readExample(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

function buildDemoCandidate() {
  const result = buildCandidate({
    compileRequest: readExample("demo-compile-request.json"),
    profile: readExample("demo-migration.json"),
  });
  if (result.status !== "complete") throw new Error(JSON.stringify(result.issues));
  return result.candidate;
}

function resolveRuntime(candidate = buildDemoCandidate()) {
  const authority = resolveCandidateAuthority(candidate, WALLET.publicKey.toBase58());
  if (authority.status !== "complete") throw new Error(JSON.stringify(authority.issues));
  const metadata = resolveCandidateMetadata(authority.candidate, METADATA_URI);
  if (metadata.status !== "complete") throw new Error(JSON.stringify(metadata.issues));
  return metadata.candidate;
}

function fakeQuoteMintInfo(): AccountInfo<Buffer> {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(0n, 36);
  data[44] = 6;
  data[45] = 1;
  return { data, executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID, rentEpoch: 0 };
}

describe("seeded demo-v1 deployment candidate", () => {
  it("builds a complete SDK candidate offline with explicit unresolved runtime requirements", () => {
    const first = buildDemoCandidate();
    const second = buildDemoCandidate();
    const prepared = prepareDeployment(first);

    expect(first).toMatchObject({
      profileId: "demo-v1",
      network: "devnet",
      market: {
        deploymentConfiguration: {
          baseToken: { decimals: 9, supplyMode: "fixed", totalSupply: "1000000000" },
          quoteToken: {
            symbol: "USDC",
            decimals: 6,
            liveVerification: "required-before-transaction-preflight",
          },
          poolCreationFeeLamports: "0",
        },
        candidate: { verificationStatus: "unverified" },
      },
      authority: { mode: "runtime-deployer" },
      metadata: { uri: DEMO_V1_METADATA_URI_PLACEHOLDER, status: "unresolved" },
      sdkValidation: {
        sdkVersion: "1.5.13",
        configurationParameters: "accepted-with-runtime-receiver-deferred",
        fixedSupplyBounds: "accepted-by-pinned-sdk-helpers",
        derivedLeftoverAtomic: "682499988885425727",
      },
      migration: {
        fee: { feeBps: 1_000n, creatorFeeShareBps: 5_000n },
        liquidityAllocation: {
          creator: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
          partner: { unlockedBps: 2_000n, permanentlyLockedBps: 1_000n, vestingBps: 2_000n },
        },
        migratedPoolFee: {
          feeBps: 100n,
          collectFeeMode: "compounding",
          compoundingFeeBps: 500n,
        },
      },
    });
    expect(first.market.candidate.id).toBe("curve-quote-69618739076-80381260923-1");
    expect(first.sdkConfig).not.toHaveProperty("leftoverReceiver");
    expect(first.sdkConfig).toMatchObject({
      migrationFeeOption: 6,
      migratedPoolBaseFeeMode: 0,
      migratedPoolFee: { poolFeeBps: 100 },
      migratedPoolMarketCapFeeSchedulerParams: {
        numberOfPeriod: 0,
        sqrtPriceStepBps: 0,
        schedulerExpirationDuration: 0,
      },
    });
    expect(serializeDeploymentCandidate(first)).toBe(serializeDeploymentCandidate(second));
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared")
      throw new Error("Expected the complete candidate to prepare");
    expect(prepared.serializedCandidate).toContain('"migrationQuoteThreshold": "150000000000"');
    expect(prepared.serializedCandidate).not.toMatch(
      /"(?:privateKey|secret|mnemonic|seedPhrase|signingMaterial)"\s*:/i,
    );
    expect(prepared.candidateDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      serializeDeploymentCandidate({
        ...first,
        runtimeSecret: { privateKey: "omitted-test-value" },
      } as never),
    ).toThrow("Deployment candidates cannot contain secrets or signing material");
  });

  it("blocks structurally incomplete or internally mismatched candidates", () => {
    const candidate = buildDemoCandidate();
    const missingSupply = {
      ...candidate,
      sdkConfig: Object.fromEntries(
        Object.entries(candidate.sdkConfig).filter(([key]) => key !== "tokenSupply"),
      ),
    };
    const changedCurve = {
      ...candidate,
      market: {
        ...candidate.market,
        candidate: {
          ...candidate.market.candidate,
          curve: {
            ...candidate.market.candidate.curve,
            migrationQuoteThresholdAtomic: 149_999_999_999n,
          },
        },
      },
    };
    const unresolvedFakeUri = {
      ...candidate,
      metadata: { ...candidate.metadata, uri: METADATA_URI },
    };
    const changedMigration = {
      ...candidate,
      migration: {
        ...candidate.migration,
        fee: { ...candidate.migration.fee, feeBps: 900n },
      },
    };
    const changedCompileRequest = readExample("demo-compile-request.json") as {
      marketIntent: { targets: { baseDistributionPct: string } };
    };
    changedCompileRequest.marketIntent.targets.baseDistributionPct = "26";

    expect(prepareDeployment(missingSupply)).toMatchObject({ status: "blocked" });
    expect(prepareDeployment(changedCurve)).toMatchObject({ status: "blocked" });
    expect(prepareDeployment(unresolvedFakeUri)).toMatchObject({ status: "blocked" });
    expect(prepareDeployment(changedMigration)).toMatchObject({ status: "blocked" });
    expect(
      buildCandidate({
        compileRequest: changedCompileRequest,
        profile: readExample("demo-migration.json"),
      }),
    ).toMatchObject({ status: "invalid", issues: [{ code: "compile_profile_mismatch" }] });
  });

  it("requires authority and published metadata before resolving the SDK transaction candidate", () => {
    const candidate = buildDemoCandidate();
    expect(resolveCandidateSdkConfig(candidate, WALLET.publicKey.toBase58())).toMatchObject({
      status: "invalid",
    });
    const authority = resolveCandidateAuthority(candidate, WALLET.publicKey.toBase58());
    expect(authority.status).toBe("complete");
    if (authority.status !== "complete") throw new Error("Expected runtime authority to resolve");
    expect(
      resolveCandidateSdkConfig(authority.candidate, WALLET.publicKey.toBase58()),
    ).toMatchObject({
      status: "invalid",
      issues: [{ code: "metadata_uri_unresolved" }],
    });
    const resolved = resolveRuntime(candidate);
    const sdkCandidate = resolveCandidateSdkConfig(resolved, WALLET.publicKey.toBase58());
    expect(sdkCandidate.status).toBe("valid");
    if (sdkCandidate.status !== "valid") throw new Error(JSON.stringify(sdkCandidate.issues));
    expect(sdkCandidate.value.leftoverReceiver.equals(WALLET.publicKey)).toBe(true);
    expect(resolveCandidateSdkConfig(resolved, OTHER_WALLET.publicKey.toBase58())).toMatchObject({
      status: "invalid",
      issues: [{ code: "runtime_authority_mismatch" }],
    });
  });

  it("assembles an unsigned pinned-SDK config-and-pool transaction with the deployer role aliases", async () => {
    const connection = new Connection(DEVNET_RPC_URL);
    const genesis = vi.spyOn(connection, "getGenesisHash").mockResolvedValue(DEVNET_GENESIS_HASH);
    const quoteRead = vi.spyOn(connection, "getAccountInfo").mockResolvedValue(fakeQuoteMintInfo());
    const unresolved = await buildDemoV1MarketTransaction({
      connection,
      candidate: buildDemoCandidate(),
      connectedWalletPublicKey: WALLET.publicKey.toBase58(),
      config: CONFIG,
      baseMint: BASE_MINT,
    });
    expect(unresolved).toMatchObject({
      status: "blocked",
      stage: "candidate-resolution",
      issues: [{ code: "runtime_authority_unresolved" }],
    });
    expect(genesis).not.toHaveBeenCalled();
    expect(quoteRead).not.toHaveBeenCalled();

    const prepared = await buildDemoV1MarketTransaction({
      connection,
      candidate: resolveRuntime(),
      connectedWalletPublicKey: WALLET.publicKey.toBase58(),
      config: CONFIG,
      baseMint: BASE_MINT,
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") throw new Error(JSON.stringify(prepared));
    const createConfig = DynamicBondingCurveIdl.instructions.find(
      (instruction) => instruction.name === "create_config",
    );
    expect(prepared.transaction.instructions).toHaveLength(2);
    expect(prepared.transaction.instructions[0]?.data.subarray(0, 8)).toEqual(
      Buffer.from(createConfig?.discriminator ?? []),
    );
    expect(prepared.feePayer).toBe(WALLET.publicKey.toBase58());
    expect(prepared.transaction.signatures.every((signature) => signature.signature === null)).toBe(
      true,
    );
    expect(
      prepared.transaction.instructions
        .flatMap((instruction) => instruction.keys)
        .some((account) => account.pubkey.equals(WALLET.publicKey) && account.isSigner),
    ).toBe(true);
  });

  it("keeps candidate preparation separate from the explicit send readiness gate", () => {
    const candidate = resolveRuntime();
    const blocked = sendDeployment({
      candidate,
      connectedWalletPublicKey: WALLET.publicKey.toBase58(),
      rpcEndpoint: "https://api.mainnet-beta.solana.com",
      genesisHash: "wrong-genesis",
      transactionMessageDigestHex: MESSAGE_DIGEST,
      preflight: { status: "failed", messageDigestHex: MESSAGE_DIGEST },
      simulation: { status: "rejected", messageDigestHex: MESSAGE_DIGEST },
      approval: {
        status: "pending",
        approverAddress: WALLET.publicKey.toBase58(),
        messageDigestHex: MESSAGE_DIGEST,
      },
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      reasons: [
        "devnet-unconfirmed",
        "preflight-incomplete",
        "simulation-incomplete",
        "approval-required",
      ],
    });

    const ready = sendDeployment({
      candidate,
      connectedWalletPublicKey: WALLET.publicKey.toBase58(),
      rpcEndpoint: DEVNET_RPC_URL,
      genesisHash: DEVNET_GENESIS_HASH,
      transactionMessageDigestHex: MESSAGE_DIGEST,
      preflight: { status: "sufficient", messageDigestHex: MESSAGE_DIGEST },
      simulation: { status: "succeeded", messageDigestHex: MESSAGE_DIGEST },
      approval: {
        status: "approved",
        approverAddress: WALLET.publicKey.toBase58(),
        messageDigestHex: MESSAGE_DIGEST,
      },
    });
    expect(ready).toMatchObject({
      status: "ready",
      broadcast: "not-invoked",
      walletAddress: WALLET.publicKey.toBase58(),
    });

    const authorityOnly = resolveCandidateAuthority(
      buildDemoCandidate(),
      WALLET.publicKey.toBase58(),
    );
    if (authorityOnly.status !== "complete") throw new Error(JSON.stringify(authorityOnly.issues));
    const metadataBlocked = sendDeployment({
      candidate: authorityOnly.candidate,
      connectedWalletPublicKey: WALLET.publicKey.toBase58(),
      rpcEndpoint: DEVNET_RPC_URL,
      genesisHash: DEVNET_GENESIS_HASH,
      transactionMessageDigestHex: MESSAGE_DIGEST,
      preflight: { status: "sufficient", messageDigestHex: MESSAGE_DIGEST },
      simulation: { status: "succeeded", messageDigestHex: MESSAGE_DIGEST },
      approval: {
        status: "approved",
        approverAddress: WALLET.publicKey.toBase58(),
        messageDigestHex: MESSAGE_DIGEST,
      },
    });
    expect(metadataBlocked).toMatchObject({
      status: "blocked",
      reasons: ["metadata-unresolved"],
    });
  });
});
