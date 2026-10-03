import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { assessDeploymentBudget } from "./deployment-budget.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import {
  previewDeploymentTransaction,
  simulateDeploymentTransaction,
} from "./deployment-preview.js";
import { compileLegacyTransactionMessage } from "./transaction-message.js";

const FEE_PAYER = new PublicKey(new Uint8Array(32).fill(1));
const RECIPIENT = new PublicKey(new Uint8Array(32).fill(2));
const RENT_ACCOUNT = new PublicKey(new Uint8Array(32).fill(3));

function transaction() {
  return new Transaction().add(
    SystemProgram.transfer({ fromPubkey: FEE_PAYER, toPubkey: RECIPIENT, lamports: 1 }),
  );
}

function transactionWithAdditionalSigner() {
  const createConfig = DynamicBondingCurveIdl.instructions.find(
    (instruction) => instruction.name === "create_config",
  );
  if (!createConfig) throw new Error("Pinned DBC IDL must include createConfig");
  return new Transaction().add(
    new TransactionInstruction({
      keys: [
        { pubkey: RECIPIENT, isSigner: true, isWritable: true },
        { pubkey: FEE_PAYER, isSigner: true, isWritable: true },
      ],
      programId: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
      data: Buffer.from(createConfig.discriminator),
    }),
  );
}

function connectionFixture(options?: {
  blockHeight?: number;
  genesisHash?: string;
  simulationError?: unknown;
  throwSimulation?: boolean;
}) {
  const connection = {
    rpcEndpoint: DEVNET_RPC_URL,
    getGenesisHash: vi.fn(async () => options?.genesisHash ?? DEVNET_GENESIS_HASH),
    getLatestBlockhashAndContext: vi.fn(async () => ({
      context: { slot: 100 },
      value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 500 },
    })),
    getBalanceAndContext: vi.fn(async () => ({ context: { slot: 101 }, value: 100_000 })),
    getFeeForMessage: vi.fn(async () => ({ context: { slot: 102 }, value: 5_000 })),
    getAccountInfoAndContext: vi.fn(async () => ({ context: { slot: 101 }, value: null })),
    getMinimumBalanceForRentExemption: vi.fn(async () => 10_000),
    getBlockHeight: vi.fn(async () => options?.blockHeight ?? 400),
    simulateTransaction: vi.fn(async () => {
      if (options?.throwSimulation) throw new Error("RPC returned credential-like error text");
      return {
        context: { slot: 104 },
        value: {
          err: options?.simulationError ?? null,
          logs: ["Program log: secret phrase must not appear in result"],
          unitsConsumed: 42,
        },
      };
    }),
  };
  return connection as unknown as Connection;
}

async function sufficientBudget(
  connection: Connection,
  prepared = transaction(),
  additionalSigners: readonly PublicKey[] = [],
) {
  const result = await assessDeploymentBudget({
    connection,
    transaction: prepared,
    feePayer: FEE_PAYER,
    additionalSigners,
    accountsToCreate: [{ address: RENT_ACCOUNT, dataLength: 1_048 }],
    additionalLamportDebits: [],
  });
  if (result.status !== "sufficient") throw new Error("Expected sufficient budget fixture");
  return result;
}

describe("Devnet transaction preview and simulation", () => {
  it("previews the exact fee-quoted legacy message and account roles", async () => {
    const connection = connectionFixture();
    const prepared = transaction();
    const budget = await sufficientBudget(connection, prepared);

    const result = await previewDeploymentTransaction({
      connection,
      transaction: prepared,
      feePayer: FEE_PAYER,
      budget,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready transaction preview");
    expect(result.preview).toMatchObject({
      network: "devnet",
      feePayer: FEE_PAYER.toBase58(),
      messageDigestHex: budget.evidence.messageDigestHex,
      blockhash: budget.evidence.blockhash,
      requiredSigners: [FEE_PAYER.toBase58()],
      budget: { totalRequiredLamports: 15_000n, remainingLamports: 85_000n },
      instructions: [
        {
          programId: SystemProgram.programId.toBase58(),
          programLabel: "Solana System Program",
          dataLength: expect.any(Number),
          accounts: [
            { address: FEE_PAYER.toBase58(), isSigner: true, isWritable: true },
            { address: RECIPIENT.toBase58(), isSigner: false, isWritable: true },
          ],
        },
      ],
    });
  });

  it("requires and previews each explicitly declared additional signer", async () => {
    const connection = connectionFixture();
    const prepared = transactionWithAdditionalSigner();
    const budget = await sufficientBudget(connection, prepared, [RECIPIENT]);

    const undeclared = await previewDeploymentTransaction({
      connection,
      transaction: prepared,
      feePayer: FEE_PAYER,
      budget,
    });
    expect(undeclared).toEqual({ status: "blocked", code: "undeclared_signer_required" });

    const declared = await simulateDeploymentTransaction({
      connection,
      transaction: prepared,
      feePayer: FEE_PAYER,
      budget,
      additionalSigners: [RECIPIENT],
    });
    expect(declared).toMatchObject({
      status: "complete",
      preview: { requiredSigners: [FEE_PAYER.toBase58(), RECIPIENT.toBase58()] },
      simulation: { status: "succeeded" },
    });
    if (declared.status !== "complete") throw new Error("Expected completed simulation");
    expect(declared.preview.instructions[0]).toMatchObject({
      instructionName: "create_config",
      instructionLabel: "Create Meteora market configuration",
    });
  });

  it("rejects a changed message or insufficient budget before simulation", async () => {
    const connection = connectionFixture();
    const budget = await sufficientBudget(connection);
    const changed = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: FEE_PAYER, toPubkey: RENT_ACCOUNT, lamports: 2 }),
    );
    const result = await simulateDeploymentTransaction({
      connection,
      transaction: changed,
      feePayer: FEE_PAYER,
      budget,
    });
    expect(result).toEqual({ status: "blocked", code: "budget_message_mismatch" });
    expect(connection.simulateTransaction).not.toHaveBeenCalled();

    const insufficient = {
      ...budget,
      status: "insufficient" as const,
      evidence: { ...budget.evidence, remainingLamports: -1n },
    };
    const insufficientResult = await simulateDeploymentTransaction({
      connection,
      transaction: transaction(),
      feePayer: FEE_PAYER,
      budget: insufficient,
    });
    expect(insufficientResult).toEqual({ status: "blocked", code: "budget_not_sufficient" });
  });

  it("simulates the same unsigned legacy message without signature verification", async () => {
    const connection = connectionFixture();
    const prepared = transaction();
    const budget = await sufficientBudget(connection, prepared);

    const result = await simulateDeploymentTransaction({
      connection,
      transaction: prepared,
      feePayer: FEE_PAYER,
      budget,
    });

    expect(result).toMatchObject({
      status: "complete",
      preview: { messageDigestHex: budget.evidence.messageDigestHex },
      simulation: { status: "succeeded", slot: 104, unitsConsumed: 42 },
    });
    const [simulated, config] = vi.mocked(connection.simulateTransaction).mock.calls[0] ?? [];
    expect(simulated).toBeInstanceOf(VersionedTransaction);
    if (!(simulated instanceof VersionedTransaction))
      throw new Error("Expected legacy message wrapper");
    expect(simulated.message.serialize()).toEqual(
      compileLegacyTransactionMessage(
        prepared.instructions,
        FEE_PAYER,
        budget.evidence.blockhash,
      ).serialize(),
    );
    expect(config).toMatchObject({
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
      minContextSlot: budget.evidence.blockhashContextSlot,
    });
  });

  it("returns a sanitized instruction failure and never returns RPC logs", async () => {
    const connection = connectionFixture({
      simulationError: { InstructionError: [0, { Custom: 12_345 }] },
    });
    const prepared = transaction();
    const budget = await sufficientBudget(connection, prepared);
    const result = await simulateDeploymentTransaction({
      connection,
      transaction: prepared,
      feePayer: FEE_PAYER,
      budget,
    });

    expect(result).toMatchObject({
      status: "complete",
      simulation: {
        status: "rejected",
        failure: "instruction_error",
        instructionIndex: 0,
      },
    });
    const serialized = JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain("Custom");
    expect(serialized).not.toContain("secret phrase");
  });

  it("blocks expired budgets and sanitizes simulation RPC failures", async () => {
    const expiredConnection = connectionFixture({ blockHeight: 501 });
    const expiredBudget = await sufficientBudget(expiredConnection);
    const expired = await simulateDeploymentTransaction({
      connection: expiredConnection,
      transaction: transaction(),
      feePayer: FEE_PAYER,
      budget: expiredBudget,
    });
    expect(expired).toEqual({ status: "unavailable", code: "budget_expired" });
    expect(expiredConnection.simulateTransaction).not.toHaveBeenCalled();

    const failingConnection = connectionFixture({ throwSimulation: true });
    const failingBudget = await sufficientBudget(failingConnection);
    const failure = await simulateDeploymentTransaction({
      connection: failingConnection,
      transaction: transaction(),
      feePayer: FEE_PAYER,
      budget: failingBudget,
    });
    expect(failure).toEqual({ status: "unavailable", code: "simulation_rpc_failed" });
    expect(JSON.stringify(failure)).not.toContain("credential-like");
  });
});
