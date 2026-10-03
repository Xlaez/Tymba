import {
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { assessDeploymentBudget } from "./deployment-budget.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";

const FEE_PAYER = new PublicKey(new Uint8Array(32).fill(1));
const RECIPIENT = new PublicKey(new Uint8Array(32).fill(2));
const RENT_ACCOUNT = new PublicKey(new Uint8Array(32).fill(3));

function transaction() {
  return new Transaction().add(
    SystemProgram.transfer({ fromPubkey: FEE_PAYER, toPubkey: RECIPIENT, lamports: 1 }),
  );
}

function connectionFixture(options?: {
  balance?: number;
  fee?: number | null;
  rent?: number;
  rentAccountExists?: boolean;
}) {
  return {
    rpcEndpoint: DEVNET_RPC_URL,
    getGenesisHash: vi.fn(async () => DEVNET_GENESIS_HASH),
    getLatestBlockhashAndContext: vi.fn(async () => ({
      context: { slot: 100 },
      value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 500 },
    })),
    getBalanceAndContext: vi.fn(async () => ({
      context: { slot: 101 },
      value: options?.balance ?? 40_001,
    })),
    getFeeForMessage: vi.fn(async () => ({
      context: { slot: 102 },
      value: options?.fee === undefined ? 5_000 : options.fee,
    })),
    getAccountInfoAndContext: vi.fn(async () => ({
      context: { slot: 101 },
      value: options?.rentAccountExists ? ({ lamports: 1 } as never) : null,
    })),
    getMinimumBalanceForRentExemption: vi.fn(async () => options?.rent ?? 10_000),
  } as unknown as Connection;
}

const request = (
  connection: Connection,
  overrides?: Partial<Parameters<typeof assessDeploymentBudget>[0]>,
) => ({
  connection,
  transaction: transaction(),
  feePayer: FEE_PAYER,
  accountsToCreate: [{ address: RENT_ACCOUNT, dataLength: 1_048 }],
  additionalLamportDebits: [25_000n, 1n],
  ...overrides,
});

describe("Devnet deployment balance and fee budget", () => {
  it("quotes the fresh-message fee, new-account rent, and declared SOL debits", async () => {
    const connection = connectionFixture();

    const result = await assessDeploymentBudget(request(connection));

    expect(result).toEqual({
      status: "sufficient",
      evidence: {
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 500,
        blockhashContextSlot: 100,
        balanceContextSlot: 101,
        feeContextSlot: 102,
        availableLamports: 40_001n,
        networkFeeLamports: 5_000n,
        accountRentLamports: 10_000n,
        additionalLamportDebits: 25_001n,
        totalRequiredLamports: 40_001n,
        remainingLamports: 0n,
      },
    });
    expect(connection.getFeeForMessage).toHaveBeenCalledOnce();
    expect(connection.getBalanceAndContext).toHaveBeenCalledWith(FEE_PAYER, {
      commitment: "confirmed",
      minContextSlot: 100,
    });
  });

  it("reports insufficient funds without rounding lamport totals", async () => {
    const result = await assessDeploymentBudget(request(connectionFixture({ balance: 40_000 })));

    expect(result).toMatchObject({
      status: "insufficient",
      evidence: {
        totalRequiredLamports: 40_001n,
        remainingLamports: -1n,
      },
    });
  });

  it("rejects mismatched payers, signed transactions, and repeated rent accounts", async () => {
    const payerBoundTransaction = transaction();
    payerBoundTransaction.feePayer = FEE_PAYER;
    const mismatched = await assessDeploymentBudget(
      request(connectionFixture(), {
        transaction: payerBoundTransaction,
        feePayer: RECIPIENT,
      }),
    );
    expect(mismatched).toEqual({ status: "invalid", code: "fee_payer_mismatch" });

    const signedTransaction = transaction();
    signedTransaction.signatures = [{ publicKey: FEE_PAYER, signature: Buffer.alloc(64, 1) }];
    const signed = await assessDeploymentBudget(
      request(connectionFixture(), { transaction: signedTransaction }),
    );
    expect(signed).toEqual({ status: "invalid", code: "transaction_already_signed" });

    const additionalSignerTransaction = transaction().add(
      new TransactionInstruction({
        keys: [
          { pubkey: FEE_PAYER, isSigner: true, isWritable: true },
          { pubkey: RECIPIENT, isSigner: true, isWritable: false },
        ],
        programId: RENT_ACCOUNT,
      }),
    );
    const additionalSigner = await assessDeploymentBudget(
      request(connectionFixture(), { transaction: additionalSignerTransaction }),
    );
    expect(additionalSigner).toEqual({ status: "invalid", code: "additional_signer_required" });

    const repeatedRentAccount = await assessDeploymentBudget(
      request(connectionFixture(), {
        accountsToCreate: [
          { address: RENT_ACCOUNT, dataLength: 1_048 },
          { address: RENT_ACCOUNT, dataLength: 1_048 },
        ],
      }),
    );
    expect(repeatedRentAccount).toEqual({
      status: "invalid",
      code: "duplicate_rent_account",
    });

    const missingRentAccountList = await assessDeploymentBudget(
      request(connectionFixture(), { accountsToCreate: [] }),
    );
    expect(missingRentAccountList).toEqual({
      status: "invalid",
      code: "rent_account_list_required",
    });
  });

  it("blocks existing rent targets and unavailable fee quotes", async () => {
    const existing = await assessDeploymentBudget(
      request(connectionFixture({ rentAccountExists: true })),
    );
    expect(existing).toEqual({ status: "unavailable", code: "rent_target_already_exists" });

    const missingFee = await assessDeploymentBudget(request(connectionFixture({ fee: null })));
    expect(missingFee).toEqual({ status: "unavailable", code: "fee_quote_unavailable" });
  });

  it("requires the pinned Devnet endpoint and genesis identity", async () => {
    const wrongEndpoint = connectionFixture();
    Object.assign(wrongEndpoint, { rpcEndpoint: "https://api.mainnet-beta.solana.com" });
    const endpointResult = await assessDeploymentBudget(request(wrongEndpoint));
    expect(endpointResult).toEqual({ status: "invalid", code: "non_devnet_connection" });

    const wrongGenesis = connectionFixture();
    vi.mocked(wrongGenesis.getGenesisHash).mockResolvedValue("unexpected-cluster");
    const genesisResult = await assessDeploymentBudget(request(wrongGenesis));
    expect(genesisResult).toEqual({ status: "unavailable", code: "devnet_identity_mismatch" });
  });

  it("sanitizes RPC errors and rejects amounts outside the safe RPC integer range", async () => {
    const throwingConnection = connectionFixture();
    vi.mocked(throwingConnection.getFeeForMessage).mockRejectedValue(
      new Error("RPC credentials must not escape"),
    );
    const rpcFailure = await assessDeploymentBudget(request(throwingConnection));
    expect(rpcFailure).toEqual({ status: "unavailable", code: "budget_rpc_failed" });
    expect(JSON.stringify(rpcFailure)).not.toContain("RPC credentials");

    const unsafeAmount = await assessDeploymentBudget(
      request(connectionFixture({ balance: Number.MAX_SAFE_INTEGER + 1 })),
    );
    expect(unsafeAmount).toEqual({ status: "unavailable", code: "budget_rpc_failed" });
  });
});
