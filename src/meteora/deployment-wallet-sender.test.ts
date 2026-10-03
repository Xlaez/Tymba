import { Buffer } from "node:buffer";
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { recordExplicitDeploymentDecision } from "./deployment-approval-gate.js";
import type { DeploymentSendResult } from "./deployment-candidate.js";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  SOLANA_DEVNET_CHAIN,
} from "./deployment-preflight.js";
import type { DeploymentTransactionPreview } from "./deployment-preview.js";
import { sendApprovedDeployment, type WalletSendRequest } from "./deployment-wallet-sender.js";
import {
  compileLegacyTransactionMessage,
  digestLegacyTransactionMessage,
} from "./transaction-message.js";

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(41));
const configSigner = Keypair.fromSeed(new Uint8Array(32).fill(42));
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(43)).publicKey.toBase58();

async function createPreparedFlow() {
  const transaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: blockhash });
  transaction.add(
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: configSigner.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([1]),
    }),
  );
  const message = compileLegacyTransactionMessage(
    transaction.instructions,
    wallet.publicKey,
    blockhash,
  );
  const messageDigestHex = await digestLegacyTransactionMessage(message);
  const preview: DeploymentTransactionPreview = {
    network: "devnet",
    feePayer: wallet.publicKey.toBase58(),
    messageDigestHex,
    blockhash,
    lastValidBlockHeight: 100,
    requiredSigners: [wallet.publicKey.toBase58(), configSigner.publicKey.toBase58()],
    budget: {
      availableLamports: 2_000_000_000n,
      networkFeeLamports: 10_000n,
      accountRentLamports: 1_000_000n,
      additionalLamportDebits: 0n,
      totalRequiredLamports: 1_010_000n,
      remainingLamports: 1_998_990_000n,
    },
    instructions: [],
  };
  const decision = recordExplicitDeploymentDecision({
    decision: "approve",
    preview,
    approverAddress: wallet.publicKey.toBase58(),
    recordedAtSeconds: 1_800_000_000n,
  });
  if (decision.status !== "recorded") throw new Error("Expected an explicit approval record");
  const readiness: Extract<DeploymentSendResult, { status: "ready" }> = {
    status: "ready",
    candidateId: "demo-v1-test",
    walletAddress: wallet.publicKey.toBase58(),
    messageDigestHex,
    broadcast: "not-invoked",
  };
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getBlockHeight").mockResolvedValue(99);
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({
    context: { slot: 501 },
    value: { err: null },
  } as never);
  return { transaction, preview, approval: decision.approval, readiness, connection };
}

function walletAccount() {
  return {
    address: wallet.publicKey.toBase58(),
    publicKey: wallet.publicKey.toBytes(),
    chains: [SOLANA_DEVNET_CHAIN],
    features: [SolanaSignAndSendTransaction],
  } as const;
}

describe("approved Devnet wallet submission", () => {
  it("requires the exact readiness and approval before calling the wallet", async () => {
    const flow = await createPreparedFlow();
    const signAndSendTransaction = vi.fn(async () => [{ signature: new Uint8Array(64).fill(7) }]);
    const result = await sendApprovedDeployment({
      ...flow,
      approval: null,
      walletAccount: walletAccount(),
      walletFeature: { signAndSendTransaction },
      getConnectedWalletAddress: () => wallet.publicKey.toBase58(),
      additionalSigners: [configSigner],
    });

    expect(result).toEqual({ status: "blocked", code: "approval_required" });
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("partially signs only with the declared runtime signer and asks the matching Devnet wallet to send", async () => {
    const flow = await createPreparedFlow();
    let sentRequest: WalletSendRequest | undefined;
    const signAndSendTransaction = vi.fn(async (request: WalletSendRequest) => {
      sentRequest = request;
      const partiallySigned = Transaction.from(request.transaction);
      const local = partiallySigned.signatures.find((entry) =>
        entry.publicKey.equals(configSigner.publicKey),
      );
      const payer = partiallySigned.signatures.find((entry) =>
        entry.publicKey.equals(wallet.publicKey),
      );
      expect(local?.signature).not.toBeNull();
      expect(payer?.signature).toBeNull();
      return [{ signature: new Uint8Array(64).fill(7) }];
    });
    const result = await sendApprovedDeployment({
      ...flow,
      walletAccount: walletAccount(),
      walletFeature: { signAndSendTransaction },
      getConnectedWalletAddress: () => wallet.publicKey.toBase58(),
      additionalSigners: [configSigner],
    });

    expect(result).toMatchObject({ status: "confirmed", slot: 501 });
    expect(result.status === "confirmed" && result.signature.length).toBeGreaterThan(80);
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(sentRequest).toMatchObject({
      account: walletAccount(),
      chain: SOLANA_DEVNET_CHAIN,
      options: { commitment: "confirmed", preflightCommitment: "confirmed", skipPreflight: false },
    });
    expect(flow.connection.confirmTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ blockhash, lastValidBlockHeight: 100 }),
      "confirmed",
    );
  });

  it("rejects changed wallets, signer sets, and a readiness digest mismatch before wallet access", async () => {
    const flow = await createPreparedFlow();
    const signAndSendTransaction = vi.fn(async () => [{ signature: new Uint8Array(64).fill(7) }]);
    const wrongWallet = Keypair.fromSeed(new Uint8Array(32).fill(44));
    const changedReadiness = { ...flow.readiness, messageDigestHex: "a".repeat(64) };

    const walletMismatch = await sendApprovedDeployment({
      ...flow,
      walletAccount: {
        address: wrongWallet.publicKey.toBase58(),
        publicKey: wrongWallet.publicKey.toBytes(),
        chains: [SOLANA_DEVNET_CHAIN],
        features: [SolanaSignAndSendTransaction],
      },
      walletFeature: { signAndSendTransaction },
      getConnectedWalletAddress: () => wrongWallet.publicKey.toBase58(),
      additionalSigners: [configSigner],
    });
    const signerMismatch = await sendApprovedDeployment({
      ...flow,
      walletAccount: walletAccount(),
      walletFeature: { signAndSendTransaction },
      getConnectedWalletAddress: () => wallet.publicKey.toBase58(),
      additionalSigners: [],
    });
    const digestMismatch = await sendApprovedDeployment({
      ...flow,
      readiness: changedReadiness,
      walletAccount: walletAccount(),
      walletFeature: { signAndSendTransaction },
      getConnectedWalletAddress: () => wallet.publicKey.toBase58(),
      additionalSigners: [configSigner],
    });

    expect(walletMismatch).toEqual({ status: "blocked", code: "wallet_account_mismatch" });
    expect(signerMismatch).toEqual({ status: "blocked", code: "invalid_additional_signers" });
    expect(digestMismatch).toEqual({ status: "blocked", code: "message_mismatch" });
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("retains the signature when confirmation cannot be fetched after the wallet submits", async () => {
    const flow = await createPreparedFlow();
    vi.mocked(flow.connection.confirmTransaction).mockRejectedValue(
      new Error("private rpc detail"),
    );
    const result = await sendApprovedDeployment({
      ...flow,
      walletAccount: walletAccount(),
      walletFeature: {
        signAndSendTransaction: async () => [{ signature: new Uint8Array(64).fill(7) }],
      },
      getConnectedWalletAddress: () => wallet.publicKey.toBase58(),
      additionalSigners: [configSigner],
    });

    expect(result).toMatchObject({
      status: "submitted-unconfirmed",
      reason: "confirmation-unavailable",
    });
  });
});
