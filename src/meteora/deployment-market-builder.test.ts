import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
  deriveMintMetadata,
  DynamicBondingCurveIdl,
  fromDecimalToBN,
  type LiquidityDistributionConfig,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";
import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "./deployment-preflight.js";
import { buildMeteoraMarketTransaction } from "./deployment-market-builder.js";

const Q64_ONE = 18_446_744_073_709_551_616n;
const CONFIG = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
const BASE_MINT = Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey;
const FEE_CLAIMER = new PublicKey(new Uint8Array(32).fill(14));
const LEFTOVER_RECEIVER = new PublicKey(new Uint8Array(32).fill(15));
const QUOTE_MINT = new PublicKey(new Uint8Array(32).fill(16));
const PAYER = Keypair.fromSeed(new Uint8Array(32).fill(17)).publicKey;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function sdkInteger(value: bigint) {
  return fromDecimalToBN(new Decimal(value.toString()));
}

function buildCandidate(
  liquidityDistribution: LiquidityDistributionConfig = {
    partnerPermanentLockedLiquidityPercentage: 5,
    partnerLiquidityPercentage: 45,
    creatorPermanentLockedLiquidityPercentage: 5,
    creatorLiquidityPercentage: 45,
  },
  sqrtPrices: readonly bigint[] = [Q64_ONE, Q64_ONE * 2n],
) {
  const config = buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.NINE,
      tokenQuoteDecimal: 6,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 100,
          endingFeeBps: 100,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution,
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices: sqrtPrices.map(sdkInteger),
  });

  return { ...config, leftoverReceiver: LEFTOVER_RECEIVER };
}

function fakeMintInfo(owner = TOKEN_PROGRAM_ID): AccountInfo<Buffer> {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(0n, 36);
  data[44] = 6;
  data[45] = 1;
  return {
    data,
    executable: false,
    lamports: 1,
    owner,
    rentEpoch: 0,
  };
}

function buildInput(overrides: Record<string, unknown> = {}) {
  const connection = new Connection(DEVNET_RPC_URL);
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockResolvedValue(fakeMintInfo());
  return {
    connection,
    candidate: buildCandidate(),
    config: CONFIG,
    baseMint: BASE_MINT,
    feeClaimer: FEE_CLAIMER,
    quoteMint: QUOTE_MINT,
    quoteDecimals: 6,
    payer: PAYER,
    tokenName: "Tymba Market",
    tokenSymbol: "TYMBA",
    tokenMetadataUri: "https://example.org/tymba-metadata.json",
    ...overrides,
  };
}

describe("pinned Meteora config and pool transaction builder", () => {
  it("builds one unsigned config-and-pool transaction with derived rent targets and signers", async () => {
    const input = buildInput();
    const result = await buildMeteoraMarketTransaction(input);

    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") throw new Error("Expected a prepared market transaction");
    const createConfig = DynamicBondingCurveIdl.instructions.find(
      (instruction) => instruction.name === "create_config",
    );
    const initializePool = DynamicBondingCurveIdl.instructions.find(
      (instruction) => instruction.name === "initialize_virtual_pool_with_spl_token",
    );
    expect(result).toMatchObject({
      sdkVersion: "1.5.13",
      configAddress: CONFIG.toBase58(),
      baseMintAddress: BASE_MINT.toBase58(),
      quoteMintAddress: QUOTE_MINT.toBase58(),
      quoteDecimals: 6,
      feePayer: PAYER.toBase58(),
      additionalSignerAddresses: [CONFIG.toBase58(), BASE_MINT.toBase58()],
      additionalLamportDebits: [0n],
      rentLayoutEvidence: "current-source-unverified-on-devnet",
      lockedLiquidityBpsAtDayOne: 1_000,
    });
    expect(result.transaction.feePayer?.equals(PAYER)).toBe(true);
    expect(result.transaction.instructions).toHaveLength(2);
    expect(result.transaction.instructions[0]?.data.subarray(0, 8)).toEqual(
      Buffer.from(createConfig?.discriminator ?? []),
    );
    expect(result.transaction.instructions[1]?.data.subarray(0, 8)).toEqual(
      Buffer.from(initializePool?.discriminator ?? []),
    );
    expect(
      result.transaction.instructions[0]?.keys.some(
        (account) => account.pubkey.equals(CONFIG) && account.isSigner && account.isWritable,
      ),
    ).toBe(true);
    expect(
      result.transaction.instructions[1]?.keys.some(
        (account) => account.pubkey.equals(BASE_MINT) && account.isSigner && account.isWritable,
      ),
    ).toBe(true);
    expect(
      result.transaction.instructions[1]?.keys.some(
        (account) => account.pubkey.equals(PAYER) && account.isSigner && account.isWritable,
      ),
    ).toBe(true);
    const pool = deriveDbcPoolAddress(QUOTE_MINT, BASE_MINT, CONFIG);
    const baseVault = deriveDbcTokenVaultAddress(pool, BASE_MINT);
    const quoteVault = deriveDbcTokenVaultAddress(pool, QUOTE_MINT);
    expect(result.poolAddress).toBe(pool.toBase58());
    expect(result.baseVaultAddress).toBe(baseVault.toBase58());
    expect(result.quoteVaultAddress).toBe(quoteVault.toBase58());
    expect(result.metadataAddress).toBe(deriveMintMetadata(BASE_MINT).toBase58());
    expect(result.rentAccounts.map(({ purpose, dataLength }) => [purpose, dataLength])).toEqual([
      ["config", 1_048],
      ["base-mint", 82],
      ["pool", 424],
      ["base-vault", 165],
      ["quote-vault", 165],
      ["metadata", 607],
    ]);
    expect(result.transaction.signatures.every((signature) => signature.signature === null)).toBe(
      true,
    );
  });

  it("blocks an incomplete SDK candidate before RPC access", async () => {
    const input = buildInput({ candidate: null });
    const result = await buildMeteoraMarketTransaction(input);

    expect(result).toMatchObject({
      status: "blocked",
      stage: "configuration-validation",
      issues: [{ code: "complete_candidate_required" }],
    });
    expect(input.connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it("includes the configured pool creation charge in the explicit SOL debit plan", async () => {
    const candidate = { ...buildCandidate(), poolCreationFee: sdkInteger(5_000_000n) };
    const result = await buildMeteoraMarketTransaction(buildInput({ candidate }));

    expect(result).toMatchObject({
      status: "prepared",
      additionalLamportDebits: [5_000_000n],
    });
  });

  it("rejects a combined transaction that exceeds Solana's wire packet limit", async () => {
    const sqrtPrices = Array.from({ length: 17 }, (_, index) => Q64_ONE * BigInt(index + 1));
    const input = buildInput({ candidate: buildCandidate(undefined, sqrtPrices) });
    const result = await buildMeteoraMarketTransaction(input);

    expect(result).toEqual({ status: "unavailable", code: "transaction_too_large" });
  });

  it("rejects invalid signer collisions and metadata before RPC access", async () => {
    const badMint = await buildMeteoraMarketTransaction(
      buildInput({ baseMint: PublicKey.default }),
    );
    expect(badMint).toMatchObject({
      status: "blocked",
      issues: [{ path: "$.baseMint", code: "invalid_base_mint_signer" }],
    });

    const collision = await buildMeteoraMarketTransaction(buildInput({ baseMint: CONFIG }));
    expect(collision).toMatchObject({
      status: "blocked",
      issues: [{ path: "$", code: "deployment_address_collision" }],
    });

    const invalidMetadata = buildInput({ tokenMetadataUri: "javascript:alert(1)" });
    const invalidUri = await buildMeteoraMarketTransaction(invalidMetadata);
    expect(invalidUri).toMatchObject({
      status: "blocked",
      issues: [{ path: "$.tokenMetadataUri", code: "invalid_token_metadata_uri" }],
    });
    expect(invalidMetadata.connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it("fails closed for network identity and quote-mint mismatches", async () => {
    const wrongNetwork = buildInput();
    vi.mocked(wrongNetwork.connection.getGenesisHash).mockResolvedValue("mainnet-genesis");
    await expect(buildMeteoraMarketTransaction(wrongNetwork)).resolves.toEqual({
      status: "unavailable",
      code: "devnet_identity_mismatch",
    });

    const wrongOwner = buildInput();
    vi.mocked(wrongOwner.connection.getAccountInfo).mockResolvedValue(
      fakeMintInfo(new PublicKey(new Uint8Array(32).fill(18))),
    );
    await expect(buildMeteoraMarketTransaction(wrongOwner)).resolves.toEqual({
      status: "unavailable",
      code: "quote_mint_not_supported",
    });

    const wrongDecimals = buildInput();
    const data = Buffer.from(fakeMintInfo().data);
    data[44] = 9;
    vi.mocked(wrongDecimals.connection.getAccountInfo).mockResolvedValue({
      ...fakeMintInfo(),
      data,
    });
    await expect(buildMeteoraMarketTransaction(wrongDecimals)).resolves.toEqual({
      status: "unavailable",
      code: "quote_decimals_mismatch",
    });
  });

  it("refuses a non-Devnet connection without RPC access", async () => {
    const input = buildInput({ connection: new Connection("https://api.mainnet-beta.solana.com") });
    const result = await buildMeteoraMarketTransaction(input);

    expect(result).toEqual({ status: "unavailable", code: "non_devnet_connection" });
  });
});
