import {
  type CreateConfigParams,
  DynamicBondingCurveClient,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { type Connection, PublicKey, type Transaction } from "@solana/web3.js";
import type { ConfigurationValidationIssue } from "../domain/configuration-validation.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";
import {
  type DeploymentTransactionGateResult,
  constructDeploymentTransactionAfterValidation,
} from "./deployment-transaction-gate.js";
import {
  type CompleteSdkConfigCandidate,
  validateCompleteSdkConfigCandidate,
} from "./complete-config-validation.js";
import { DEVNET_RPC_URL } from "./deployment-preflight.js";

export type MeteoraConfigTransactionBuildInput = Readonly<{
  connection: Connection;
  candidate: unknown;
  config: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  tokenBadge?: PublicKey;
}>;

type PreparedConfigTransaction = Readonly<{
  transaction: Transaction;
  sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
  lockedLiquidityBpsAtDayOne: number;
  configAddress: string;
  feePayer: string;
  additionalSignerAddresses: readonly string[];
}>;

type ValidatedConfigBuildInput = Readonly<{
  candidate: CompleteSdkConfigCandidate;
  config: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  tokenBadge?: PublicKey;
  lockedLiquidityBpsAtDayOne: number;
}>;

export type MeteoraConfigTransactionBuildResult =
  | (PreparedConfigTransaction & Readonly<{ status: "prepared" }>)
  | Exclude<DeploymentTransactionGateResult<Transaction>, { status: "prepared" }>
  | Readonly<{ status: "unavailable"; code: "non_devnet_connection" }>;

function issue(path: string, code: string, message: string): ConfigurationValidationIssue {
  return { path, code, message };
}

function validPublicKey(value: unknown): value is PublicKey {
  return value instanceof PublicKey && !value.equals(PublicKey.default);
}

function validateBuildInput(input: MeteoraConfigTransactionBuildInput) {
  const candidate = validateCompleteSdkConfigCandidate(input.candidate);
  if (candidate.status === "invalid") return candidate;

  const issues: ConfigurationValidationIssue[] = [];
  if (!validPublicKey(input.config) || !PublicKey.isOnCurve(input.config.toBytes())) {
    issues.push(
      issue(
        "$.config",
        "invalid_config_signer",
        "A non-default on-curve config signer public key is required.",
      ),
    );
  }
  if (!validPublicKey(input.feeClaimer)) {
    issues.push(
      issue(
        "$.feeClaimer",
        "invalid_fee_claimer",
        "A non-default fee claimer public key is required.",
      ),
    );
  }
  if (!validPublicKey(input.quoteMint)) {
    issues.push(
      issue(
        "$.quoteMint",
        "invalid_quote_mint",
        "A non-default quote mint public key is required.",
      ),
    );
  }
  if (!validPublicKey(input.payer) || !PublicKey.isOnCurve(input.payer.toBytes())) {
    issues.push(
      issue("$.payer", "invalid_payer", "A non-default on-curve payer public key is required."),
    );
  }
  if (input.tokenBadge !== undefined && !validPublicKey(input.tokenBadge)) {
    issues.push(
      issue(
        "$.tokenBadge",
        "invalid_token_badge",
        "The optional token badge must be a non-default public key.",
      ),
    );
  }
  if (validPublicKey(input.config)) {
    const collidingAddress = [
      input.feeClaimer,
      input.quoteMint,
      input.payer,
      candidate.value.leftoverReceiver,
      input.tokenBadge,
    ].some((address) => validPublicKey(address) && input.config.equals(address));
    if (collidingAddress) {
      issues.push(
        issue(
          "$.config",
          "config_address_collision",
          "The config signer address must be distinct from every other configuration account.",
        ),
      );
    }
  }
  if (issues.length > 0) return { status: "invalid" as const, issues };

  return {
    status: "valid" as const,
    value: {
      candidate: candidate.value,
      config: input.config,
      feeClaimer: input.feeClaimer,
      quoteMint: input.quoteMint,
      payer: input.payer,
      ...(input.tokenBadge ? { tokenBadge: input.tokenBadge } : {}),
      lockedLiquidityBpsAtDayOne: candidate.evidence.lockedLiquidityBpsAtDayOne,
    },
  };
}

export async function buildMeteoraConfigTransaction(
  input: MeteoraConfigTransactionBuildInput,
): Promise<MeteoraConfigTransactionBuildResult> {
  if (!input.connection || input.connection.rpcEndpoint !== DEVNET_RPC_URL) {
    return { status: "unavailable", code: "non_devnet_connection" };
  }

  const result = await constructDeploymentTransactionAfterValidation<
    MeteoraConfigTransactionBuildInput,
    ValidatedConfigBuildInput,
    PreparedConfigTransaction
  >({
    input,
    validate: validateBuildInput,
    construct: async (validated) => {
      const params: CreateConfigParams = {
        ...validated.candidate,
        config: validated.config,
        feeClaimer: validated.feeClaimer,
        quoteMint: validated.quoteMint,
        payer: validated.payer,
        ...(validated.tokenBadge ? { tokenBadge: validated.tokenBadge } : {}),
      };
      const transaction = await DynamicBondingCurveClient.create(
        input.connection,
      ).partner.createConfig(params);
      transaction.feePayer = validated.payer;
      return {
        transaction,
        sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
        lockedLiquidityBpsAtDayOne: validated.lockedLiquidityBpsAtDayOne,
        configAddress: validated.config.toBase58(),
        feePayer: validated.payer.toBase58(),
        additionalSignerAddresses: [validated.config.toBase58()],
      };
    },
  });

  if (result.status !== "prepared") return result;
  return { status: "prepared", ...result.transaction };
}
