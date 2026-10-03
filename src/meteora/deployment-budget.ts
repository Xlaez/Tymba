import { type Connection, PublicKey, Transaction } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import {
  compileLegacyTransactionMessage,
  digestLegacyTransactionMessage,
} from "./transaction-message.js";

export type DeploymentRentAccount = Readonly<{
  address: PublicKey;
  dataLength: number;
}>;

export type DeploymentBudgetRequest = Readonly<{
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  additionalSigners?: readonly PublicKey[];
  accountsToCreate: readonly DeploymentRentAccount[];
  additionalLamportDebits: readonly bigint[];
}>;

export type DeploymentBudgetEvidence = Readonly<{
  blockhash: string;
  lastValidBlockHeight: number;
  blockhashContextSlot: number;
  balanceContextSlot: number;
  feeContextSlot: number;
  feePayer: string;
  requiredSignerAddresses: readonly string[];
  messageDigestHex: string;
  availableLamports: bigint;
  networkFeeLamports: bigint;
  accountRentLamports: bigint;
  additionalLamportDebits: bigint;
  totalRequiredLamports: bigint;
  remainingLamports: bigint;
}>;

export type DeploymentBudgetResult =
  | Readonly<{ status: "sufficient"; evidence: DeploymentBudgetEvidence }>
  | Readonly<{ status: "insufficient"; evidence: DeploymentBudgetEvidence }>
  | Readonly<{
      status: "invalid";
      code:
        | "fee_payer_mismatch"
        | "invalid_transaction"
        | "non_devnet_connection"
        | "transaction_has_no_instructions"
        | "transaction_already_signed"
        | "invalid_declared_signer"
        | "duplicate_declared_signer"
        | "undeclared_signer_required"
        | "declared_signer_not_required"
        | "invalid_rent_account"
        | "rent_account_list_required"
        | "duplicate_rent_account"
        | "invalid_additional_debit";
    }>
  | Readonly<{
      status: "unavailable";
      code:
        | "devnet_identity_mismatch"
        | "fee_quote_unavailable"
        | "rent_target_already_exists"
        | "budget_rpc_failed";
    }>;

function asLamports(value: number): bigint | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
}

function validContextSlot(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

export async function assessDeploymentBudget(
  request: DeploymentBudgetRequest,
): Promise<DeploymentBudgetResult> {
  const { connection, transaction, feePayer } = request;

  if (
    !(transaction instanceof Transaction) ||
    !(feePayer instanceof PublicKey) ||
    !Array.isArray(request.accountsToCreate) ||
    !Array.isArray(request.additionalLamportDebits)
  ) {
    return { status: "invalid", code: "invalid_transaction" };
  }
  if (connection.rpcEndpoint !== DEVNET_RPC_URL) {
    return { status: "invalid", code: "non_devnet_connection" };
  }
  if (transaction.feePayer && !transaction.feePayer.equals(feePayer)) {
    return { status: "invalid", code: "fee_payer_mismatch" };
  }
  if (transaction.instructions.length === 0) {
    return { status: "invalid", code: "transaction_has_no_instructions" };
  }
  if (transaction.signatures.some((signature) => signature.signature !== null)) {
    return { status: "invalid", code: "transaction_already_signed" };
  }
  const declaredSigners = request.additionalSigners ?? [];
  if (
    !Array.isArray(declaredSigners) ||
    declaredSigners.some((signer) => !(signer instanceof PublicKey))
  ) {
    return { status: "invalid", code: "invalid_declared_signer" };
  }
  const declaredSignerAddresses = declaredSigners.map((signer) => signer.toBase58());
  if (new Set(declaredSignerAddresses).size !== declaredSignerAddresses.length) {
    return { status: "invalid", code: "duplicate_declared_signer" };
  }
  if (declaredSignerAddresses.includes(feePayer.toBase58())) {
    return { status: "invalid", code: "invalid_declared_signer" };
  }

  if (request.accountsToCreate.length === 0) {
    return { status: "invalid", code: "rent_account_list_required" };
  }

  const rentAccountAddresses = new Set<string>();
  for (const account of request.accountsToCreate) {
    if (
      typeof account !== "object" ||
      account === null ||
      !(account.address instanceof PublicKey)
    ) {
      return { status: "invalid", code: "invalid_rent_account" };
    }
    const address = account.address.toBase58();
    if (!Number.isSafeInteger(account.dataLength) || account.dataLength <= 0) {
      return { status: "invalid", code: "invalid_rent_account" };
    }
    if (rentAccountAddresses.has(address)) {
      return { status: "invalid", code: "duplicate_rent_account" };
    }
    rentAccountAddresses.add(address);
  }

  const additionalLamportDebits = request.additionalLamportDebits;
  if (additionalLamportDebits.some((amount) => typeof amount !== "bigint" || amount < 0n)) {
    return { status: "invalid", code: "invalid_additional_debit" };
  }
  const additionalTotal = additionalLamportDebits.reduce((total, amount) => total + amount, 0n);

  try {
    const genesisHash = await connection.getGenesisHash();
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      return { status: "unavailable", code: "devnet_identity_mismatch" };
    }
    const latestBlockhash = await connection.getLatestBlockhashAndContext("confirmed");
    if (
      !validContextSlot(latestBlockhash.context.slot, 0) ||
      !validContextSlot(latestBlockhash.value.lastValidBlockHeight, 0) ||
      typeof latestBlockhash.value.blockhash !== "string"
    ) {
      return { status: "unavailable", code: "budget_rpc_failed" };
    }
    const message = compileLegacyTransactionMessage(
      transaction.instructions,
      feePayer,
      latestBlockhash.value.blockhash,
    );
    const requiredSignerAddresses = message.accountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    const requiredSignerSet = new Set(requiredSignerAddresses);
    if (!requiredSignerSet.has(feePayer.toBase58())) {
      return { status: "invalid", code: "fee_payer_mismatch" };
    }
    if (declaredSignerAddresses.some((address) => !requiredSignerSet.has(address))) {
      return { status: "invalid", code: "declared_signer_not_required" };
    }
    if (
      requiredSignerAddresses.some(
        (address) => address !== feePayer.toBase58() && !declaredSignerAddresses.includes(address),
      )
    ) {
      return { status: "invalid", code: "undeclared_signer_required" };
    }
    const messageDigestHex = await digestLegacyTransactionMessage(message);

    const [balanceResponse, feeResponse, rentResults] = await Promise.all([
      connection.getBalanceAndContext(feePayer, {
        commitment: "confirmed",
        minContextSlot: latestBlockhash.context.slot,
      }),
      connection.getFeeForMessage(message, "confirmed"),
      Promise.all(
        request.accountsToCreate.map(async ({ address, dataLength }) => {
          const accountInfo = await connection.getAccountInfoAndContext(address, {
            commitment: "confirmed",
            minContextSlot: latestBlockhash.context.slot,
          });
          if (!validContextSlot(accountInfo.context.slot, latestBlockhash.context.slot)) {
            return { status: "failed" as const };
          }
          if (accountInfo.value !== null) return { status: "exists" as const };
          const lamports = await connection.getMinimumBalanceForRentExemption(
            dataLength,
            "confirmed",
          );
          return { status: "quoted" as const, lamports };
        }),
      ),
    ]);

    if (rentResults.some((result) => result.status === "exists")) {
      return { status: "unavailable", code: "rent_target_already_exists" };
    }
    if (rentResults.some((result) => result.status === "failed")) {
      return { status: "unavailable", code: "budget_rpc_failed" };
    }
    if (feeResponse.value === null) {
      return { status: "unavailable", code: "fee_quote_unavailable" };
    }
    if (
      !validContextSlot(balanceResponse.context.slot, latestBlockhash.context.slot) ||
      !validContextSlot(feeResponse.context.slot, latestBlockhash.context.slot)
    ) {
      return { status: "unavailable", code: "budget_rpc_failed" };
    }

    const availableLamports = asLamports(balanceResponse.value);
    const networkFeeLamports = asLamports(feeResponse.value);
    const rentAmounts = rentResults.flatMap((result) =>
      result.status === "quoted" ? [asLamports(result.lamports)] : [],
    );
    if (availableLamports === undefined || networkFeeLamports === undefined) {
      return { status: "unavailable", code: "budget_rpc_failed" };
    }

    const validRentAmounts: bigint[] = [];
    for (const amount of rentAmounts) {
      if (amount === undefined) return { status: "unavailable", code: "budget_rpc_failed" };
      validRentAmounts.push(amount);
    }
    const accountRentLamports = validRentAmounts.reduce((total, amount) => total + amount, 0n);
    const totalRequiredLamports = networkFeeLamports + accountRentLamports + additionalTotal;
    const remainingLamports = availableLamports - totalRequiredLamports;
    const evidence: DeploymentBudgetEvidence = {
      blockhash: latestBlockhash.value.blockhash,
      lastValidBlockHeight: latestBlockhash.value.lastValidBlockHeight,
      blockhashContextSlot: latestBlockhash.context.slot,
      balanceContextSlot: balanceResponse.context.slot,
      feeContextSlot: feeResponse.context.slot,
      feePayer: feePayer.toBase58(),
      requiredSignerAddresses,
      messageDigestHex,
      availableLamports,
      networkFeeLamports,
      accountRentLamports,
      additionalLamportDebits: additionalTotal,
      totalRequiredLamports,
      remainingLamports,
    };

    return {
      status: remainingLamports >= 0n ? "sufficient" : "insufficient",
      evidence,
    };
  } catch {
    return { status: "unavailable", code: "budget_rpc_failed" };
  }
}
