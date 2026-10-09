import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import {
  buildCandidate,
  buildDemoV1MarketTransaction,
  prepareDeployment,
  resolveCandidateAuthority,
  resolveCandidateMetadata,
  sendDeployment,
} from "../meteora/deployment-candidate.js";
import { DEMO_V1_METADATA_URI } from "../meteora/demo-v1-metadata.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "../meteora/deployment-preflight.js";
import { isRecord } from "./review.js";

function profile(): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "examples/demo-migration.json"), "utf8"),
  ) as unknown;
}

function candidateFor(input: unknown) {
  if (!isRecord(input) || typeof input.candidateId !== "string")
    throw new TypeError("Select a compiled market draft.");
  const result = buildCandidate({
    compileRequest: input.compileRequest,
    profile: profile(),
    candidateId: input.candidateId,
  });
  if (result.status !== "complete") return { status: "blocked" as const, issues: result.issues };
  const prepared = prepareDeployment(result.candidate);
  if (prepared.status !== "prepared")
    return { status: "blocked" as const, issues: prepared.issues };
  return prepared;
}

export function prepareWebDeploymentCandidate(input: unknown) {
  const result = candidateFor(input);
  if (result.status !== "prepared") return result;
  return {
    status: "prepared" as const,
    candidate: result.serializedCandidate,
    candidateDigestHex: result.candidateDigestHex,
  };
}

export async function assembleWebDeploymentTransaction(input: unknown) {
  if (
    !isRecord(input) ||
    typeof input.walletAddress !== "string" ||
    typeof input.configAddress !== "string" ||
    typeof input.baseMintAddress !== "string" ||
    typeof input.metadataUri !== "string"
  )
    throw new TypeError("Runtime wallet, signer addresses, and metadata URI are required.");
  if (input.metadataUri !== DEMO_V1_METADATA_URI)
    return {
      status: "blocked" as const,
      issues: [
        {
          code: "demo_metadata_uri_mismatch",
          message: "Use the published demo-v1 Devnet metadata JSON URL.",
        },
      ],
    };
  const result = candidateFor(input);
  if (result.status !== "prepared") return result;
  const authority = resolveCandidateAuthority(result.candidate, input.walletAddress);
  if (authority.status !== "complete")
    return { status: "blocked" as const, issues: authority.issues };
  const metadata = resolveCandidateMetadata(authority.candidate, input.metadataUri);
  if (metadata.status !== "complete")
    return { status: "blocked" as const, issues: metadata.issues };
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const transaction = await buildDemoV1MarketTransaction({
    connection,
    candidate: metadata.candidate,
    connectedWalletPublicKey: input.walletAddress,
    config: new PublicKey(input.configAddress),
    baseMint: new PublicKey(input.baseMintAddress),
  });
  if (transaction.status !== "prepared")
    return {
      status: "blocked" as const,
      stage: "issues" in transaction ? transaction.stage : "devnet-validation",
      issues:
        "issues" in transaction
          ? transaction.issues
          : [{ code: transaction.code, message: "Devnet transaction preparation did not pass." }],
    };
  const resolvedCandidate = prepareDeployment(metadata.candidate);
  if (resolvedCandidate.status !== "prepared")
    return { status: "blocked" as const, issues: resolvedCandidate.issues };
  return {
    status: "prepared" as const,
    candidate: resolvedCandidate.serializedCandidate,
    candidateDigestHex: resolvedCandidate.candidateDigestHex,
    transactionBase64: unsignedTransactionBase64(transaction.transaction),
    feePayer: transaction.feePayer,
    configAddress: transaction.configAddress,
    baseMintAddress: transaction.baseMintAddress,
    poolAddress: transaction.poolAddress,
    baseVaultAddress: transaction.baseVaultAddress,
    quoteVaultAddress: transaction.quoteVaultAddress,
    metadataAddress: transaction.metadataAddress,
    quoteMintAddress: transaction.quoteMintAddress,
    quoteDecimals: transaction.quoteDecimals,
    additionalSignerAddresses: transaction.additionalSignerAddresses,
    rentAccounts: transaction.rentAccounts.map((account) => ({
      address: account.address.toBase58(),
      dataLength: account.dataLength,
    })),
    additionalLamportDebits: transaction.additionalLamportDebits.map(String),
    sdkVersion: transaction.sdkVersion,
    rentLayoutEvidence: transaction.rentLayoutEvidence,
  };
}

function unsignedTransactionBase64(transaction: Transaction): string {
  transaction.recentBlockhash = PublicKey.default.toBase58();
  const bytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  return bytes.toString("base64");
}

export function checkWebDeploymentReadiness(input: unknown) {
  if (
    !isRecord(input) ||
    !isRecord(input.preflight) ||
    !isRecord(input.simulation) ||
    !isRecord(input.approval)
  )
    throw new TypeError("Deployment readiness evidence is incomplete.");
  const candidate = prepareDeployment(input.candidate);
  if (candidate.status !== "prepared") return candidate;
  return sendDeployment({
    candidate: candidate.candidate,
    connectedWalletPublicKey: String(input.connectedWalletPublicKey ?? ""),
    rpcEndpoint: DEVNET_RPC_URL,
    genesisHash: DEVNET_GENESIS_HASH,
    transactionMessageDigestHex: String(input.transactionMessageDigestHex ?? ""),
    preflight: input.preflight as { status: "sufficient" | "failed"; messageDigestHex: string },
    simulation: input.simulation as { status: "succeeded" | "rejected"; messageDigestHex: string },
    approval: input.approval as {
      status: "approved" | "rejected" | "pending";
      approverAddress: string;
      messageDigestHex: string;
    },
  });
}
