import type { Connection } from "@solana/web3.js";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import type { DeploymentTransactionPreview } from "./deployment-preview.js";
import {
  compileLegacyTransactionMessage,
  digestLegacyTransactionMessage,
} from "./transaction-message.js";

export type DeploymentApproval = Readonly<{
  status: "pending" | "approved" | "rejected";
  recordedAtSeconds?: bigint;
  approverAddress?: string;
  messageDigestHex?: string;
}>;

export type DeploymentDecisionResult =
  | Readonly<{ status: "recorded"; approval: DeploymentApproval }>
  | Readonly<{
      status: "invalid";
      code: "invalid_decision" | "invalid_approver" | "invalid_preview" | "invalid_timestamp";
    }>;

export type DeploymentApprovalGateResult<Value> =
  | Readonly<{ status: "executed"; value: Value }>
  | Readonly<{
      status: "blocked";
      code:
        | "approval_required"
        | "approval_rejected"
        | "invalid_approval"
        | "approver_mismatch"
        | "message_mismatch"
        | "invalid_transaction"
        | "transaction_already_signed"
        | "non_devnet_connection"
        | "devnet_identity_mismatch"
        | "budget_expired";
    }>
  | Readonly<{ status: "failed"; code: "approved_action_failed" }>
  | Readonly<{ status: "unavailable"; code: "approval_rpc_failed" }>;

function validAddress(value: string): boolean {
  try {
    const publicKey = new PublicKey(value);
    return publicKey.toBase58() === value && PublicKey.isOnCurve(publicKey);
  } catch {
    return false;
  }
}

function validDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function snapshotTransaction(
  transaction: Transaction,
  feePayer: PublicKey,
  blockhash: string,
): Transaction {
  const snapshot = new Transaction({ feePayer, recentBlockhash: blockhash });
  snapshot.add(
    ...transaction.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId.toBytes()),
          keys: instruction.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey.toBytes()),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          data: new Uint8Array(instruction.data) as typeof instruction.data,
        }),
    ),
  );
  return snapshot;
}

export function recordExplicitDeploymentDecision(options: {
  decision: "approve" | "reject";
  preview: DeploymentTransactionPreview;
  approverAddress: string;
  recordedAtSeconds: bigint;
}): DeploymentDecisionResult {
  if (options.decision !== "approve" && options.decision !== "reject") {
    return { status: "invalid", code: "invalid_decision" };
  }
  if (!validAddress(options.approverAddress)) {
    return { status: "invalid", code: "invalid_approver" };
  }
  if (
    options.preview.network !== "devnet" ||
    options.preview.feePayer !== options.approverAddress ||
    !validDigest(options.preview.messageDigestHex)
  ) {
    return { status: "invalid", code: "invalid_preview" };
  }
  if (typeof options.recordedAtSeconds !== "bigint" || options.recordedAtSeconds < 0n) {
    return { status: "invalid", code: "invalid_timestamp" };
  }

  return {
    status: "recorded",
    approval: {
      status: options.decision === "approve" ? "approved" : "rejected",
      recordedAtSeconds: options.recordedAtSeconds,
      approverAddress: options.approverAddress,
      messageDigestHex: options.preview.messageDigestHex,
    },
  };
}

export async function executeAfterExplicitDeploymentApproval<Value>(options: {
  approval: DeploymentApproval | null;
  transaction: Transaction;
  preview: DeploymentTransactionPreview;
  connection: Connection;
  getConnectedWalletAddress: () => string | null;
  execute: (
    transaction: Transaction,
    preview: DeploymentTransactionPreview,
  ) => Value | Promise<Value>;
}): Promise<DeploymentApprovalGateResult<Value>> {
  const { approval, transaction, preview, connection, getConnectedWalletAddress } = options;
  if (!approval || approval.status === "pending") {
    return { status: "blocked", code: "approval_required" };
  }
  if (approval.status === "rejected") return { status: "blocked", code: "approval_rejected" };
  if (
    approval.status !== "approved" ||
    typeof approval.recordedAtSeconds !== "bigint" ||
    approval.recordedAtSeconds < 0n ||
    typeof approval.approverAddress !== "string" ||
    !validAddress(approval.approverAddress) ||
    typeof approval.messageDigestHex !== "string" ||
    !validDigest(approval.messageDigestHex)
  ) {
    return { status: "blocked", code: "invalid_approval" };
  }
  let connectedWalletAddress: string | null;
  try {
    connectedWalletAddress = getConnectedWalletAddress();
  } catch {
    return { status: "blocked", code: "approver_mismatch" };
  }
  if (!connectedWalletAddress || !validAddress(connectedWalletAddress)) {
    return { status: "blocked", code: "approver_mismatch" };
  }
  if (approval.approverAddress !== connectedWalletAddress) {
    return { status: "blocked", code: "approver_mismatch" };
  }
  if (
    preview.network !== "devnet" ||
    preview.feePayer !== connectedWalletAddress ||
    approval.messageDigestHex !== preview.messageDigestHex
  ) {
    return { status: "blocked", code: "message_mismatch" };
  }
  if (!(transaction instanceof Transaction) || transaction.instructions.length === 0) {
    return { status: "blocked", code: "invalid_transaction" };
  }
  if (transaction.signatures.some((signature) => signature.signature !== null)) {
    return { status: "blocked", code: "transaction_already_signed" };
  }
  const feePayer = new PublicKey(preview.feePayer);
  if (transaction.feePayer && !transaction.feePayer.equals(feePayer)) {
    return { status: "blocked", code: "message_mismatch" };
  }
  let currentMessageDigest: string;
  let requiredSignerAddresses: string[];
  let approvedTransaction: Transaction;
  try {
    approvedTransaction = snapshotTransaction(transaction, feePayer, preview.blockhash);
    const message = compileLegacyTransactionMessage(
      approvedTransaction.instructions,
      feePayer,
      preview.blockhash,
    );
    currentMessageDigest = await digestLegacyTransactionMessage(message);
    requiredSignerAddresses = message.accountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
  } catch {
    return { status: "blocked", code: "invalid_transaction" };
  }
  if (
    currentMessageDigest !== preview.messageDigestHex ||
    currentMessageDigest !== approval.messageDigestHex ||
    requiredSignerAddresses.length !== preview.requiredSigners.length ||
    requiredSignerAddresses.some((address, index) => address !== preview.requiredSigners[index])
  ) {
    return { status: "blocked", code: "message_mismatch" };
  }
  if (connection.rpcEndpoint !== DEVNET_RPC_URL) {
    return { status: "blocked", code: "non_devnet_connection" };
  }

  if (!Number.isSafeInteger(preview.lastValidBlockHeight) || preview.lastValidBlockHeight < 0) {
    return { status: "blocked", code: "invalid_approval" };
  }

  let currentBlockHeight: number;
  try {
    const genesisHash = await connection.getGenesisHash();
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      return { status: "blocked", code: "devnet_identity_mismatch" };
    }
    currentBlockHeight = await connection.getBlockHeight("confirmed");
  } catch {
    return { status: "unavailable", code: "approval_rpc_failed" };
  }
  if (!Number.isSafeInteger(currentBlockHeight) || currentBlockHeight < 0) {
    return { status: "unavailable", code: "approval_rpc_failed" };
  }
  if (currentBlockHeight > preview.lastValidBlockHeight) {
    return { status: "blocked", code: "budget_expired" };
  }
  try {
    if (getConnectedWalletAddress() !== approval.approverAddress) {
      return { status: "blocked", code: "approver_mismatch" };
    }
  } catch {
    return { status: "blocked", code: "approver_mismatch" };
  }

  try {
    return { status: "executed", value: await options.execute(approvedTransaction, preview) };
  } catch {
    return { status: "failed", code: "approved_action_failed" };
  }
}
