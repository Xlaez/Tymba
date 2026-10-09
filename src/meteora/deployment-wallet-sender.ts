import type { SolanaSignAndSendTransactionInput } from "@solana/wallet-standard-features";
import { type Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import type { DeploymentApproval } from "./deployment-approval-gate.js";
import { executeAfterExplicitDeploymentApproval } from "./deployment-approval-gate.js";
import type { DeploymentSendResult } from "./deployment-candidate.js";
import { SOLANA_DEVNET_CHAIN } from "./deployment-preflight.js";
import type { DeploymentTransactionPreview } from "./deployment-preview.js";

export type WalletSendRequest = Readonly<{
  account: SolanaSignAndSendTransactionInput["account"];
  chain: typeof SOLANA_DEVNET_CHAIN;
  transaction: Uint8Array;
  options: Readonly<{
    commitment: "confirmed";
    preflightCommitment: "confirmed";
    skipPreflight: false;
  }>;
}>;

export type WalletSendFeature = Readonly<{
  signAndSendTransaction: (
    ...requests: readonly WalletSendRequest[]
  ) => Promise<readonly unknown[]>;
}>;

export type WalletSubmissionResult =
  | Readonly<{
      status: "confirmed";
      signature: string;
      slot: number;
    }>
  | Readonly<{
      status: "confirmed-failed";
      signature: string;
      slot: number;
    }>
  | Readonly<{
      status: "submitted-unconfirmed";
      signature: string;
      reason: "confirmation-unavailable";
    }>
  | Readonly<{
      status: "outcome-unknown";
      reason: "wallet-rejected-or-failed" | "wallet-returned-invalid-signature";
    }>
  | Readonly<{
      status: "preflight-rejected";
      reason: "blockhash-not-found";
    }>
  | Readonly<{
      status: "failed-before-wallet";
      reason: "runtime-signer-failed";
    }>
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
        | "budget_expired"
        | "approval_rpc_failed"
        | "invalid_additional_signers"
        | "wallet_account_mismatch";
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let value = BigInt(`0x${hex}`);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = `${alphabet[remainder]}${encoded}`;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function walletSignature(value: unknown): string | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !(value[0].signature instanceof Uint8Array) ||
    value[0].signature.length !== 64
  )
    return undefined;
  return encodeBase58(value[0].signature);
}

function walletErrorText(value: unknown, depth = 0): string {
  if (depth > 3) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.message} ${walletErrorText(value.cause, depth + 1)}`;
  if (!isRecord(value)) return "";
  return ["message", "code", "data", "cause", "err", "logs"]
    .map((key) => walletErrorText(value[key], depth + 1))
    .filter(Boolean)
    .join(" ");
}

function isBlockhashPreflightFailure(value: unknown): boolean {
  return /blockhash(?: not found|notfound)/i.test(walletErrorText(value));
}

function signerSetMatches(
  requiredSigners: readonly string[],
  feePayer: string,
  signers: readonly Keypair[],
): boolean {
  if (!Array.isArray(signers)) return false;
  const signerAddresses: string[] = [];
  for (const signer of signers) {
    if (
      typeof signer !== "object" ||
      signer === null ||
      !(signer instanceof Keypair) ||
      !(signer.publicKey instanceof PublicKey) ||
      !(signer.secretKey instanceof Uint8Array) ||
      signer.secretKey.length !== 64
    ) {
      return false;
    }
    signerAddresses.push(signer.publicKey.toBase58());
  }
  if (
    new Set(signerAddresses).size !== signerAddresses.length ||
    signerAddresses.includes(feePayer)
  )
    return false;
  const expected = requiredSigners.filter((address) => address !== feePayer).sort();
  const actual = signerAddresses.sort();
  return (
    expected.length === actual.length &&
    expected.every((address, index) => address === actual[index])
  );
}

export async function sendApprovedDeployment(options: {
  approval: DeploymentApproval | null;
  readiness: Extract<DeploymentSendResult, { status: "ready" }>;
  transaction: Transaction;
  preview: DeploymentTransactionPreview;
  connection: Connection;
  getConnectedWalletAddress: () => string | null;
  walletAccount: SolanaSignAndSendTransactionInput["account"];
  walletFeature: WalletSendFeature;
  additionalSigners: readonly Keypair[];
}): Promise<WalletSubmissionResult> {
  const walletAddress = options.walletAccount.address;
  let connectedAddress: string | null;
  try {
    connectedAddress = options.getConnectedWalletAddress();
  } catch {
    connectedAddress = null;
  }
  if (
    !Array.isArray(options.walletAccount.chains) ||
    !options.walletAccount.chains.includes(SOLANA_DEVNET_CHAIN) ||
    walletAddress !== options.preview.feePayer ||
    connectedAddress !== walletAddress
  ) {
    return { status: "blocked", code: "wallet_account_mismatch" };
  }
  if (
    options.readiness.broadcast !== "not-invoked" ||
    options.readiness.walletAddress !== walletAddress ||
    options.readiness.messageDigestHex !== options.preview.messageDigestHex
  ) {
    return { status: "blocked", code: "message_mismatch" };
  }
  if (
    !signerSetMatches(
      options.preview.requiredSigners,
      options.preview.feePayer,
      options.additionalSigners,
    )
  ) {
    return { status: "blocked", code: "invalid_additional_signers" };
  }

  const result = await executeAfterExplicitDeploymentApproval({
    approval: options.approval,
    transaction: options.transaction,
    preview: options.preview,
    connection: options.connection,
    getConnectedWalletAddress: options.getConnectedWalletAddress,
    execute: async (transaction, preview) => {
      let currentAddress: string | null;
      try {
        currentAddress = options.getConnectedWalletAddress();
      } catch {
        currentAddress = null;
      }
      if (currentAddress !== walletAddress) {
        return { status: "blocked" as const, code: "wallet_account_mismatch" as const };
      }
      let serialized: Uint8Array;
      try {
        if (options.additionalSigners.length > 0) {
          transaction.partialSign(...options.additionalSigners);
        }
        serialized = transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: true,
        });
      } catch {
        return {
          status: "failed-before-wallet" as const,
          reason: "runtime-signer-failed" as const,
        };
      }
      let walletResult: readonly unknown[];
      try {
        walletResult = await options.walletFeature.signAndSendTransaction({
          account: options.walletAccount,
          chain: SOLANA_DEVNET_CHAIN,
          transaction: serialized,
          options: {
            commitment: "confirmed",
            preflightCommitment: "confirmed",
            skipPreflight: false,
          },
        });
      } catch (error) {
        if (isBlockhashPreflightFailure(error)) {
          return { status: "preflight-rejected" as const, reason: "blockhash-not-found" as const };
        }
        return { status: "outcome-unknown" as const, reason: "wallet-rejected-or-failed" as const };
      }
      const signature = walletSignature(walletResult);
      if (!signature) {
        return {
          status: "outcome-unknown" as const,
          reason: "wallet-returned-invalid-signature" as const,
        };
      }
      try {
        const confirmation = await options.connection.confirmTransaction(
          {
            signature,
            blockhash: preview.blockhash,
            lastValidBlockHeight: preview.lastValidBlockHeight,
          },
          "confirmed",
        );
        const slot = confirmation.context.slot;
        if (!Number.isSafeInteger(slot) || slot < 0) {
          return {
            status: "submitted-unconfirmed" as const,
            signature,
            reason: "confirmation-unavailable" as const,
          };
        }
        return confirmation.value.err === null
          ? { status: "confirmed" as const, signature, slot }
          : { status: "confirmed-failed" as const, signature, slot };
      } catch {
        return {
          status: "submitted-unconfirmed" as const,
          signature,
          reason: "confirmation-unavailable" as const,
        };
      }
    },
  });

  if (result.status === "blocked") return result;
  if (result.status === "unavailable") {
    return { status: "blocked", code: "approval_rpc_failed" };
  }
  if (result.status === "failed") {
    return { status: "outcome-unknown", reason: "wallet-rejected-or-failed" };
  }
  return result.value;
}
