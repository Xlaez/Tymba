import {
  DynamicBondingCurveClient,
  TokenType,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
  deriveMintMetadata,
  getTokenDecimals,
  getTokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { CreateConfigAndPoolParams } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PACKET_DATA_SIZE, type Connection, PublicKey, Transaction } from "@solana/web3.js";
import type { ConfigurationValidationIssue } from "../domain/configuration-validation.js";
import { PINNED_METEORA_DBC_SDK_VERSION } from "../domain/solver-sdk-validation.js";
import {
  type CompleteSdkConfigCandidate,
  validateCompleteSdkConfigCandidate,
} from "./complete-config-validation.js";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import {
  type DeploymentTransactionGateResult,
  constructDeploymentTransactionAfterValidation,
} from "./deployment-transaction-gate.js";

const CONFIG_ACCOUNT_DATA_LENGTH = 1_048;
const VIRTUAL_POOL_ACCOUNT_DATA_LENGTH = 424;
const SPL_MINT_ACCOUNT_DATA_LENGTH = 82;
const SPL_TOKEN_ACCOUNT_DATA_LENGTH = 165;
const METAPLEX_METADATA_ACCOUNT_DATA_LENGTH = 607;

export type MeteoraMarketTransactionBuildInput = Readonly<{
  connection: Connection;
  candidate: unknown;
  config: PublicKey;
  baseMint: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  quoteDecimals: number;
  payer: PublicKey;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  tokenBadge?: PublicKey;
}>;

export type MeteoraMarketRentAccount = Readonly<{
  address: PublicKey;
  dataLength: number;
  purpose: "config" | "pool" | "base-mint" | "base-vault" | "quote-vault" | "metadata";
}>;

type PreparedMarketTransaction = Readonly<{
  transaction: Transaction;
  sdkVersion: typeof PINNED_METEORA_DBC_SDK_VERSION;
  lockedLiquidityBpsAtDayOne: number;
  configAddress: string;
  baseMintAddress: string;
  poolAddress: string;
  baseVaultAddress: string;
  quoteVaultAddress: string;
  metadataAddress: string;
  quoteMintAddress: string;
  quoteDecimals: number;
  feePayer: string;
  additionalSignerAddresses: readonly string[];
  rentAccounts: readonly MeteoraMarketRentAccount[];
  additionalLamportDebits: readonly bigint[];
  rentLayoutEvidence: "current-source-unverified-on-devnet";
}>;

type ValidatedMarketBuildInput = Readonly<{
  candidate: CompleteSdkConfigCandidate;
  config: PublicKey;
  baseMint: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  quoteDecimals: number;
  payer: PublicKey;
  tokenName: string;
  tokenSymbol: string;
  tokenMetadataUri: string;
  tokenBadge?: PublicKey;
  lockedLiquidityBpsAtDayOne: number;
  poolCreationFeeLamports: bigint;
}>;

export type MeteoraMarketTransactionBuildResult =
  | (PreparedMarketTransaction & Readonly<{ status: "prepared" }>)
  | Exclude<DeploymentTransactionGateResult<Transaction>, { status: "prepared" }>
  | Readonly<{
      status: "unavailable";
      code:
        | "non_devnet_connection"
        | "devnet_identity_mismatch"
        | "devnet_identity_unavailable"
        | "quote_mint_unavailable"
        | "quote_mint_not_supported"
        | "quote_decimals_mismatch"
        | "transaction_too_large";
    }>;

function issue(path: string, code: string, message: string): ConfigurationValidationIssue {
  return { path, code, message };
}

function validPublicKey(value: unknown): value is PublicKey {
  return value instanceof PublicKey && !value.equals(PublicKey.default);
}

function validSigner(value: unknown): value is PublicKey {
  return validPublicKey(value) && PublicKey.isOnCurve(value.toBytes());
}

function validMetadataText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value) &&
    new TextEncoder().encode(value).length <= maxBytes
  );
}

function validMetadataUri(value: unknown): value is string {
  if (!validMetadataText(value, 200)) return false;
  try {
    const uri = new URL(value);
    return (
      (uri.protocol === "https:" || uri.protocol === "ipfs:") &&
      uri.hostname.length > 0 &&
      uri.username.length === 0 &&
      uri.password.length === 0
    );
  } catch {
    return false;
  }
}

function asLamports(value: unknown): bigint | undefined {
  try {
    const amount = BigInt(String(value));
    return amount >= 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

function validateBuildInput(input: MeteoraMarketTransactionBuildInput) {
  const candidate = validateCompleteSdkConfigCandidate(input.candidate);
  if (candidate.status === "invalid") return candidate;

  const issues: ConfigurationValidationIssue[] = [];
  if (!validSigner(input.config)) {
    issues.push(
      issue(
        "$.config",
        "invalid_config_signer",
        "A non-default on-curve config signer public key is required.",
      ),
    );
  }
  if (!validSigner(input.baseMint)) {
    issues.push(
      issue(
        "$.baseMint",
        "invalid_base_mint_signer",
        "A non-default on-curve base-mint signer public key is required.",
      ),
    );
  }
  if (!validPublicKey(input.feeClaimer)) {
    issues.push(
      issue("$.feeClaimer", "invalid_fee_claimer", "A non-default fee claimer is required."),
    );
  }
  if (!validPublicKey(input.quoteMint)) {
    issues.push(
      issue("$.quoteMint", "invalid_quote_mint", "A non-default quote mint is required."),
    );
  }
  if (
    !Number.isSafeInteger(input.quoteDecimals) ||
    input.quoteDecimals < 0 ||
    input.quoteDecimals > 9
  ) {
    issues.push(
      issue(
        "$.quoteDecimals",
        "invalid_quote_decimals",
        "Quote decimals must be a whole number from 0 to 9.",
      ),
    );
  }
  if (!validSigner(input.payer)) {
    issues.push(issue("$.payer", "invalid_payer", "A non-default on-curve fee payer is required."));
  }
  if (candidate.value.tokenType !== TokenType.SPLToken) {
    issues.push(
      issue(
        "$.candidate.tokenType",
        "unsupported_base_token_type",
        "This pool builder accepts classic SPL base tokens only.",
      ),
    );
  }
  if (!validMetadataText(input.tokenName, 32)) {
    issues.push(
      issue(
        "$.tokenName",
        "invalid_token_name",
        "Token name must contain 1 to 32 UTF-8 bytes without surrounding whitespace or control characters.",
      ),
    );
  }
  if (!validMetadataText(input.tokenSymbol, 10)) {
    issues.push(
      issue(
        "$.tokenSymbol",
        "invalid_token_symbol",
        "Token symbol must contain 1 to 10 UTF-8 bytes without surrounding whitespace or control characters.",
      ),
    );
  }
  if (!validMetadataUri(input.tokenMetadataUri)) {
    issues.push(
      issue(
        "$.tokenMetadataUri",
        "invalid_token_metadata_uri",
        "Token metadata URI must be an absolute HTTPS or IPFS URI no longer than 200 UTF-8 bytes.",
      ),
    );
  }
  if (input.tokenBadge !== undefined && !validPublicKey(input.tokenBadge)) {
    issues.push(
      issue(
        "$.tokenBadge",
        "invalid_token_badge",
        "An optional token badge must be a non-default public key.",
      ),
    );
  }

  const independentAddresses = [
    input.config,
    input.baseMint,
    input.quoteMint,
    input.tokenBadge,
  ].filter(validPublicKey);
  const deployerRoleAddresses = [input.payer, input.feeClaimer, candidate.value.leftoverReceiver];
  const independentAddressSet = new Set(independentAddresses.map((address) => address.toBase58()));
  const independentCollision =
    independentAddressSet.size !== independentAddresses.length ||
    deployerRoleAddresses.some((address) => independentAddressSet.has(address.toBase58()));
  if (independentCollision) {
    issues.push(
      issue(
        "$",
        "deployment_address_collision",
        "Config, mint, and optional token badge addresses must be distinct from each other and the deployer wallet.",
      ),
    );
  }

  const poolCreationFeeLamports = asLamports(candidate.value.poolCreationFee);
  if (poolCreationFeeLamports === undefined) {
    issues.push(
      issue(
        "$.candidate.poolCreationFee",
        "invalid_pool_creation_fee",
        "Pool creation fee must be a non-negative integer number of lamports.",
      ),
    );
  }

  if (issues.length > 0 || poolCreationFeeLamports === undefined) {
    return { status: "invalid" as const, issues };
  }

  return {
    status: "valid" as const,
    value: {
      candidate: candidate.value,
      config: input.config,
      baseMint: input.baseMint,
      feeClaimer: input.feeClaimer,
      quoteMint: input.quoteMint,
      quoteDecimals: input.quoteDecimals,
      payer: input.payer,
      tokenName: input.tokenName,
      tokenSymbol: input.tokenSymbol,
      tokenMetadataUri: input.tokenMetadataUri,
      ...(input.tokenBadge ? { tokenBadge: input.tokenBadge } : {}),
      lockedLiquidityBpsAtDayOne: candidate.evidence.lockedLiquidityBpsAtDayOne,
      poolCreationFeeLamports,
    },
  };
}

export async function buildMeteoraMarketTransaction(
  input: MeteoraMarketTransactionBuildInput,
): Promise<MeteoraMarketTransactionBuildResult> {
  if (!input.connection || input.connection.rpcEndpoint !== DEVNET_RPC_URL) {
    return { status: "unavailable", code: "non_devnet_connection" };
  }

  const preliminary = validateBuildInput(input);
  if (preliminary.status === "invalid") {
    return { status: "blocked", stage: "configuration-validation", issues: preliminary.issues };
  }

  try {
    const genesisHash = await input.connection.getGenesisHash();
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      return { status: "unavailable", code: "devnet_identity_mismatch" };
    }
  } catch {
    return { status: "unavailable", code: "devnet_identity_unavailable" };
  }

  try {
    const quoteMintType = await getTokenType(input.connection, preliminary.value.quoteMint);
    if (quoteMintType === null) return { status: "unavailable", code: "quote_mint_unavailable" };
    if (quoteMintType !== TokenType.SPLToken) {
      return { status: "unavailable", code: "quote_mint_not_supported" };
    }
    const actualQuoteDecimals = await getTokenDecimals(
      input.connection,
      preliminary.value.quoteMint,
    );
    if (actualQuoteDecimals !== preliminary.value.quoteDecimals) {
      return { status: "unavailable", code: "quote_decimals_mismatch" };
    }
  } catch {
    return { status: "unavailable", code: "quote_mint_unavailable" };
  }

  const result = await constructDeploymentTransactionAfterValidation<
    MeteoraMarketTransactionBuildInput,
    ValidatedMarketBuildInput,
    PreparedMarketTransaction
  >({
    input,
    validate: validateBuildInput,
    construct: async (validated) => {
      const params: CreateConfigAndPoolParams = {
        ...validated.candidate,
        config: validated.config,
        feeClaimer: validated.feeClaimer,
        quoteMint: validated.quoteMint,
        payer: validated.payer,
        preCreatePoolParam: {
          name: validated.tokenName,
          symbol: validated.tokenSymbol,
          uri: validated.tokenMetadataUri,
          poolCreator: validated.payer,
          baseMint: validated.baseMint,
        },
        ...(validated.tokenBadge ? { tokenBadge: validated.tokenBadge } : {}),
      };
      const transaction = await DynamicBondingCurveClient.create(
        input.connection,
      ).partner.createConfigAndPool(params);
      transaction.feePayer = validated.payer;
      if (transaction.instructions.length !== 2)
        throw new Error("Unexpected SDK transaction shape");

      const poolAddress = deriveDbcPoolAddress(
        validated.quoteMint,
        validated.baseMint,
        validated.config,
      );
      const baseVaultAddress = deriveDbcTokenVaultAddress(poolAddress, validated.baseMint);
      const quoteVaultAddress = deriveDbcTokenVaultAddress(poolAddress, validated.quoteMint);
      const metadataAddress = deriveMintMetadata(validated.baseMint);
      const rentAccounts: readonly MeteoraMarketRentAccount[] = [
        { address: validated.config, dataLength: CONFIG_ACCOUNT_DATA_LENGTH, purpose: "config" },
        {
          address: validated.baseMint,
          dataLength: SPL_MINT_ACCOUNT_DATA_LENGTH,
          purpose: "base-mint",
        },
        { address: poolAddress, dataLength: VIRTUAL_POOL_ACCOUNT_DATA_LENGTH, purpose: "pool" },
        {
          address: baseVaultAddress,
          dataLength: SPL_TOKEN_ACCOUNT_DATA_LENGTH,
          purpose: "base-vault",
        },
        {
          address: quoteVaultAddress,
          dataLength: SPL_TOKEN_ACCOUNT_DATA_LENGTH,
          purpose: "quote-vault",
        },
        {
          address: metadataAddress,
          dataLength: METAPLEX_METADATA_ACCOUNT_DATA_LENGTH,
          purpose: "metadata",
        },
      ];
      const rentAddresses = rentAccounts.map(({ address }) => address.toBase58());
      if (new Set(rentAddresses).size !== rentAddresses.length) {
        throw new Error("Derived account address collision");
      }

      return {
        transaction,
        sdkVersion: PINNED_METEORA_DBC_SDK_VERSION,
        lockedLiquidityBpsAtDayOne: validated.lockedLiquidityBpsAtDayOne,
        configAddress: validated.config.toBase58(),
        baseMintAddress: validated.baseMint.toBase58(),
        poolAddress: poolAddress.toBase58(),
        baseVaultAddress: baseVaultAddress.toBase58(),
        quoteVaultAddress: quoteVaultAddress.toBase58(),
        metadataAddress: metadataAddress.toBase58(),
        quoteMintAddress: validated.quoteMint.toBase58(),
        quoteDecimals: validated.quoteDecimals,
        feePayer: validated.payer.toBase58(),
        additionalSignerAddresses: [validated.config.toBase58(), validated.baseMint.toBase58()],
        rentAccounts,
        additionalLamportDebits: [validated.poolCreationFeeLamports],
        rentLayoutEvidence: "current-source-unverified-on-devnet",
      };
    },
  });

  if (result.status !== "prepared") return result;
  try {
    const probe = new Transaction({
      feePayer: new PublicKey(result.transaction.feePayer),
      recentBlockhash: PublicKey.default.toBase58(),
    });
    probe.add(...result.transaction.transaction.instructions);
    const wire = probe.serialize({ requireAllSignatures: false, verifySignatures: false });
    if (wire.length > PACKET_DATA_SIZE) {
      return { status: "unavailable", code: "transaction_too_large" };
    }
  } catch {
    return { status: "unavailable", code: "transaction_too_large" };
  }
  return { status: "prepared", ...result.transaction };
}
