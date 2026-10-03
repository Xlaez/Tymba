import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  type Connection,
  PublicKey,
  SystemProgram,
  type Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { DeploymentBudgetResult } from "./deployment-budget.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import {
  compileLegacyTransactionMessage,
  digestLegacyTransactionMessage,
} from "./transaction-message.js";

type SufficientBudget = Extract<DeploymentBudgetResult, { status: "sufficient" }>;
type PreviewBlockedCode =
  | "budget_not_sufficient"
  | "fee_payer_mismatch"
  | "transaction_has_no_instructions"
  | "transaction_already_signed"
  | "invalid_declared_signer"
  | "duplicate_declared_signer"
  | "undeclared_signer_required"
  | "declared_signer_not_required"
  | "budget_signer_mismatch"
  | "budget_message_mismatch";

export type DeploymentInstructionPreview = Readonly<{
  index: number;
  programId: string;
  programLabel: string;
  instructionName?: string;
  instructionLabel?: string;
  dataLength: number;
  accounts: readonly Readonly<{
    address: string;
    isSigner: boolean;
    isWritable: boolean;
  }>[];
}>;

export type DeploymentTransactionPreview = Readonly<{
  network: "devnet";
  feePayer: string;
  messageDigestHex: string;
  blockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: readonly string[];
  budget: Readonly<{
    availableLamports: bigint;
    networkFeeLamports: bigint;
    accountRentLamports: bigint;
    additionalLamportDebits: bigint;
    totalRequiredLamports: bigint;
    remainingLamports: bigint;
  }>;
  instructions: readonly DeploymentInstructionPreview[];
}>;

export type DeploymentPreviewResult =
  | Readonly<{ status: "ready"; preview: DeploymentTransactionPreview }>
  | Readonly<{
      status: "blocked";
      code: PreviewBlockedCode;
    }>
  | Readonly<{ status: "unavailable"; code: "non_devnet_connection" | "preview_failed" }>;

export type DeploymentSimulationResult =
  | Readonly<{
      status: "complete";
      preview: DeploymentTransactionPreview;
      simulation:
        | Readonly<{ status: "succeeded"; slot: number; unitsConsumed?: number }>
        | Readonly<{
            status: "rejected";
            slot: number;
            failure: "instruction_error" | "simulation_error";
            instructionIndex?: number;
            unitsConsumed?: number;
          }>;
    }>
  | Readonly<{
      status: "blocked";
      code: Exclude<DeploymentPreviewResult, { status: "ready" | "unavailable" }> extends {
        code: infer Code;
      }
        ? Code
        : never;
    }>
  | Readonly<{
      status: "unavailable";
      code:
        | "non_devnet_connection"
        | "devnet_identity_mismatch"
        | "budget_expired"
        | "preview_failed"
        | "simulation_rpc_failed";
    }>;

const instructionLabels: Readonly<Record<string, string>> = {
  create_config: "Create Meteora market configuration",
  initialize_virtual_pool_with_spl_token: "Initialize Meteora market pool",
};

function instructionPreview(transaction: Transaction): readonly DeploymentInstructionPreview[] {
  return transaction.instructions.map((instruction, index) => {
    const isDbc = instruction.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID);
    const isSystem = instruction.programId.equals(SystemProgram.programId);
    let instructionName: string | undefined;
    if (isDbc) {
      instructionName = DynamicBondingCurveIdl.instructions.find((definition) =>
        definition.discriminator.every(
          (byte, discriminatorIndex) => instruction.data[discriminatorIndex] === byte,
        ),
      )?.name;
    }

    return {
      index,
      programId: instruction.programId.toBase58(),
      programLabel: isDbc ? "Meteora DBC" : isSystem ? "Solana System Program" : "Other program",
      ...(instructionName ? { instructionName } : {}),
      ...(instructionName && instructionLabels[instructionName]
        ? { instructionLabel: instructionLabels[instructionName] }
        : {}),
      dataLength: instruction.data.length,
      accounts: instruction.keys.map((key) => ({
        address: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
    };
  });
}

function failureKind(error: unknown): Readonly<{
  failure: "instruction_error" | "simulation_error";
  instructionIndex?: number;
}> {
  if (typeof error === "object" && error !== null) {
    const instructionError = (error as Record<string, unknown>).InstructionError;
    if (
      Array.isArray(instructionError) &&
      Number.isSafeInteger(instructionError[0]) &&
      (instructionError[0] as number) >= 0
    ) {
      return { failure: "instruction_error", instructionIndex: instructionError[0] as number };
    }
  }
  return { failure: "simulation_error" };
}

function safeUnitsConsumed(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}

function safeSlot(value: number): number | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function previewDeploymentTransaction(options: {
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  budget: SufficientBudget;
  additionalSigners?: readonly PublicKey[];
}): Promise<DeploymentPreviewResult> {
  const { connection, transaction, feePayer, budget } = options;

  if (connection.rpcEndpoint !== DEVNET_RPC_URL) {
    return { status: "unavailable", code: "non_devnet_connection" };
  }
  if (budget.status !== "sufficient") return { status: "blocked", code: "budget_not_sufficient" };
  if (transaction.feePayer && !transaction.feePayer.equals(feePayer)) {
    return { status: "blocked", code: "fee_payer_mismatch" };
  }
  if (transaction.instructions.length === 0) {
    return { status: "blocked", code: "transaction_has_no_instructions" };
  }
  if (transaction.signatures.some((signature) => signature.signature !== null)) {
    return { status: "blocked", code: "transaction_already_signed" };
  }
  const additionalSigners = options.additionalSigners ?? [];
  if (
    !Array.isArray(additionalSigners) ||
    additionalSigners.some((signer) => !(signer instanceof PublicKey))
  ) {
    return { status: "blocked", code: "invalid_declared_signer" };
  }
  const additionalSignerAddresses = additionalSigners.map((signer) => signer.toBase58());
  if (new Set(additionalSignerAddresses).size !== additionalSignerAddresses.length) {
    return { status: "blocked", code: "duplicate_declared_signer" };
  }
  if (additionalSignerAddresses.includes(feePayer.toBase58())) {
    return { status: "blocked", code: "invalid_declared_signer" };
  }

  try {
    if (budget.evidence.feePayer !== feePayer.toBase58()) {
      return { status: "blocked", code: "fee_payer_mismatch" };
    }
    const message = compileLegacyTransactionMessage(
      transaction.instructions,
      feePayer,
      budget.evidence.blockhash,
    );
    const requiredSigners = message.accountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    const requiredSignerSet = new Set(requiredSigners);
    if (!requiredSignerSet.has(feePayer.toBase58())) {
      return { status: "blocked", code: "fee_payer_mismatch" };
    }
    if (additionalSignerAddresses.some((address) => !requiredSignerSet.has(address))) {
      return { status: "blocked", code: "declared_signer_not_required" };
    }
    if (
      requiredSigners.some(
        (address) =>
          address !== feePayer.toBase58() && !additionalSignerAddresses.includes(address),
      )
    ) {
      return { status: "blocked", code: "undeclared_signer_required" };
    }
    const evidenceSignerSet = new Set(budget.evidence.requiredSignerAddresses);
    if (
      requiredSigners.length !== evidenceSignerSet.size ||
      requiredSigners.some((address) => !evidenceSignerSet.has(address))
    ) {
      return { status: "blocked", code: "budget_signer_mismatch" };
    }
    const messageDigestHex = await digestLegacyTransactionMessage(message);
    if (messageDigestHex !== budget.evidence.messageDigestHex) {
      return { status: "blocked", code: "budget_message_mismatch" };
    }

    const preview: DeploymentTransactionPreview = {
      network: "devnet",
      feePayer: feePayer.toBase58(),
      messageDigestHex,
      blockhash: budget.evidence.blockhash,
      lastValidBlockHeight: budget.evidence.lastValidBlockHeight,
      requiredSigners,
      budget: {
        availableLamports: budget.evidence.availableLamports,
        networkFeeLamports: budget.evidence.networkFeeLamports,
        accountRentLamports: budget.evidence.accountRentLamports,
        additionalLamportDebits: budget.evidence.additionalLamportDebits,
        totalRequiredLamports: budget.evidence.totalRequiredLamports,
        remainingLamports: budget.evidence.remainingLamports,
      },
      instructions: instructionPreview(transaction),
    };
    return { status: "ready", preview };
  } catch {
    return { status: "unavailable", code: "preview_failed" };
  }
}

export async function simulateDeploymentTransaction(options: {
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  budget: DeploymentBudgetResult;
  additionalSigners?: readonly PublicKey[];
}): Promise<DeploymentSimulationResult> {
  const budget = options.budget;
  if (budget.status !== "sufficient") {
    return { status: "blocked", code: "budget_not_sufficient" };
  }

  const previewResult = await previewDeploymentTransaction({
    connection: options.connection,
    transaction: options.transaction,
    feePayer: options.feePayer,
    budget,
    ...(options.additionalSigners !== undefined
      ? { additionalSigners: options.additionalSigners }
      : {}),
  });
  if (previewResult.status === "blocked") return previewResult;
  if (previewResult.status === "unavailable") return previewResult;

  try {
    const genesisHash = await options.connection.getGenesisHash();
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      return { status: "unavailable", code: "devnet_identity_mismatch" };
    }
    const currentBlockHeight = await options.connection.getBlockHeight("confirmed");
    if (safeSlot(currentBlockHeight) === undefined) {
      return { status: "unavailable", code: "simulation_rpc_failed" };
    }
    if (currentBlockHeight > budget.evidence.lastValidBlockHeight) {
      return { status: "unavailable", code: "budget_expired" };
    }

    const message = compileLegacyTransactionMessage(
      options.transaction.instructions,
      options.feePayer,
      budget.evidence.blockhash,
    );
    const unsignedTransaction = new VersionedTransaction(message);
    const response = await options.connection.simulateTransaction(unsignedTransaction, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
      minContextSlot: budget.evidence.blockhashContextSlot,
    });
    const slot = safeSlot(response.context.slot);
    if (slot === undefined) return { status: "unavailable", code: "simulation_rpc_failed" };
    const unitsConsumed = safeUnitsConsumed(response.value.unitsConsumed);
    const baseResult = {
      status: "complete" as const,
      preview: previewResult.preview,
    };
    if (response.value.err === null) {
      return {
        ...baseResult,
        simulation: {
          status: "succeeded",
          slot,
          ...(unitsConsumed !== undefined ? { unitsConsumed } : {}),
        },
      };
    }

    const failure = failureKind(response.value.err);
    return {
      ...baseResult,
      simulation: {
        status: "rejected",
        slot,
        ...failure,
        ...(unitsConsumed !== undefined ? { unitsConsumed } : {}),
      },
    };
  } catch {
    return { status: "unavailable", code: "simulation_rpc_failed" };
  }
}
