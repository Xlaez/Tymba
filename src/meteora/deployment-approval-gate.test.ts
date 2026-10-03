import { type Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  executeAfterExplicitDeploymentApproval,
  recordExplicitDeploymentDecision,
} from "./deployment-approval-gate.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import type { DeploymentTransactionPreview } from "./deployment-preview.js";
import {
  compileLegacyTransactionMessage,
  digestLegacyTransactionMessage,
} from "./transaction-message.js";

const FEE_PAYER_KEY = new PublicKey(new Uint8Array(32).fill(1));
const FEE_PAYER = FEE_PAYER_KEY.toBase58();
const RECIPIENT = new PublicKey(new Uint8Array(32).fill(4));
const OTHER_WALLET = "24tRRtpSAdWi83PHTtHfw2tAqzdLTPL9wQkzvAiXKjsL";
const BLOCKHASH = PublicKey.default.toBase58();
let transaction: Transaction;
let preview: DeploymentTransactionPreview;

beforeAll(async () => {
  transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: FEE_PAYER_KEY, toPubkey: RECIPIENT, lamports: 1 }),
  );
  const message = compileLegacyTransactionMessage(
    transaction.instructions,
    FEE_PAYER_KEY,
    BLOCKHASH,
  );
  const messageDigestHex = await digestLegacyTransactionMessage(message);
  preview = {
    network: "devnet",
    feePayer: FEE_PAYER,
    messageDigestHex,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 500,
    requiredSigners: message.accountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58()),
    budget: {
      availableLamports: 100_000n,
      networkFeeLamports: 5_000n,
      accountRentLamports: 10_000n,
      additionalLamportDebits: 0n,
      totalRequiredLamports: 15_000n,
      remainingLamports: 85_000n,
    },
    instructions: [],
  };
});

function approvedDecision() {
  const result = recordExplicitDeploymentDecision({
    decision: "approve",
    preview,
    approverAddress: FEE_PAYER,
    recordedAtSeconds: 1_791_062_400n,
  });
  if (result.status !== "recorded") throw new Error("Expected an approval record");
  return result.approval;
}

function connectionFixture(options?: {
  blockHeight?: number;
  endpoint?: string;
  genesisHash?: string;
  throwRpc?: boolean;
}) {
  return {
    rpcEndpoint: options?.endpoint ?? DEVNET_RPC_URL,
    getGenesisHash: vi.fn(async () => {
      if (options?.throwRpc) throw new Error("RPC credentials must not escape");
      return options?.genesisHash ?? DEVNET_GENESIS_HASH;
    }),
    getBlockHeight: vi.fn(async () => {
      if (options?.throwRpc) throw new Error("RPC credentials must not escape");
      return options?.blockHeight ?? 400;
    }),
  } as unknown as Connection;
}

describe("explicit deployment approval gate", () => {
  it("records only a public decision bound to the exact preview and fee payer", () => {
    expect(
      recordExplicitDeploymentDecision({
        decision: "approve",
        preview,
        approverAddress: FEE_PAYER,
        recordedAtSeconds: 1_791_062_400n,
      }),
    ).toEqual({
      status: "recorded",
      approval: {
        status: "approved",
        recordedAtSeconds: 1_791_062_400n,
        approverAddress: FEE_PAYER,
        messageDigestHex: preview.messageDigestHex,
      },
    });
    expect(
      recordExplicitDeploymentDecision({
        decision: "approve",
        preview,
        approverAddress: OTHER_WALLET,
        recordedAtSeconds: 1n,
      }),
    ).toEqual({ status: "invalid", code: "invalid_preview" });
  });

  it("never invokes the approved action without an explicit matching approval", async () => {
    const execute = vi.fn(async () => "signed");
    const unapproved = await executeAfterExplicitDeploymentApproval({
      approval: null,
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(unapproved).toEqual({ status: "blocked", code: "approval_required" });

    const rejectedRecord = recordExplicitDeploymentDecision({
      decision: "reject",
      preview,
      approverAddress: FEE_PAYER,
      recordedAtSeconds: 2n,
    });
    if (rejectedRecord.status !== "recorded") throw new Error("Expected a rejection record");
    const rejected = await executeAfterExplicitDeploymentApproval({
      approval: rejectedRecord.approval,
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(rejected).toEqual({ status: "blocked", code: "approval_rejected" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only when approver, current wallet, message digest, and expiry match", async () => {
    const execute = vi.fn(
      async (_transaction: Transaction, _preview: DeploymentTransactionPreview) => {
        return "wallet-result";
      },
    );
    const result = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(result).toEqual({ status: "executed", value: "wallet-result" });
    expect(execute).toHaveBeenCalledOnce();
    const [approvedTransaction, approvedPreview] = execute.mock.calls[0] ?? [];
    expect(approvedTransaction).toBeInstanceOf(Transaction);
    expect(approvedTransaction).not.toBe(transaction);
    expect(approvedTransaction?.recentBlockhash).toBe(preview.blockhash);
    expect(approvedPreview).toBe(preview);

    const changedPreview = { ...preview, messageDigestHex: "b".repeat(64) };
    const mismatch = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview: changedPreview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(mismatch).toEqual({ status: "blocked", code: "message_mismatch" });

    const changedTransaction = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: FEE_PAYER_KEY, toPubkey: RECIPIENT, lamports: 2 }),
    );
    const transactionMismatch = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction: changedTransaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(transactionMismatch).toEqual({ status: "blocked", code: "message_mismatch" });

    const wrongWallet = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => OTHER_WALLET,
      execute,
    });
    expect(wrongWallet).toEqual({ status: "blocked", code: "approver_mismatch" });

    const expired = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture({ blockHeight: 501 }),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(expired).toEqual({ status: "blocked", code: "budget_expired" });
    expect(execute).toHaveBeenCalledOnce();

    let walletReads = 0;
    const changedWalletDuringCheck = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => {
        walletReads += 1;
        return walletReads === 1 ? FEE_PAYER : OTHER_WALLET;
      },
      execute: vi.fn(async () => "must-not-run"),
    });
    expect(changedWalletDuringCheck).toEqual({ status: "blocked", code: "approver_mismatch" });
  });

  it("fails closed on a different network or unavailable Devnet identity", async () => {
    const execute = vi.fn(async () => "signed");
    const wrongEndpoint = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture({ endpoint: "https://api.mainnet-beta.solana.com" }),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(wrongEndpoint).toEqual({ status: "blocked", code: "non_devnet_connection" });

    const wrongGenesis = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture({ genesisHash: "not-devnet" }),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(wrongGenesis).toEqual({ status: "blocked", code: "devnet_identity_mismatch" });

    const unavailable = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture({ throwRpc: true }),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute,
    });
    expect(unavailable).toEqual({ status: "unavailable", code: "approval_rpc_failed" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("sanitizes signing or broadcast adapter failures", async () => {
    const result = await executeAfterExplicitDeploymentApproval({
      approval: approvedDecision(),
      transaction,
      preview,
      connection: connectionFixture(),
      getConnectedWalletAddress: () => FEE_PAYER,
      execute: () => {
        throw new Error("wallet returned private signing detail");
      },
    });
    expect(result).toEqual({ status: "failed", code: "approved_action_failed" });
    expect(JSON.stringify(result)).not.toContain("private signing detail");
  });
});
