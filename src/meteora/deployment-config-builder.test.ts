import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  DynamicBondingCurveIdl,
  fromDecimalToBN,
  type LiquidityDistributionConfig,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { DEVNET_RPC_URL } from "./deployment-preflight.js";
import { buildMeteoraConfigTransaction } from "./deployment-config-builder.js";

const Q64_ONE = 18_446_744_073_709_551_616n;
const CONFIG = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const FEE_CLAIMER = new PublicKey(new Uint8Array(32).fill(3));
const LEFTOVER_RECEIVER = new PublicKey(new Uint8Array(32).fill(4));
const QUOTE_MINT = new PublicKey(new Uint8Array(32).fill(5));
const PAYER = Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey;

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
    sqrtPrices: [Q64_ONE, Q64_ONE * 2n].map(sdkInteger),
  });

  return { ...config, leftoverReceiver: LEFTOVER_RECEIVER };
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    connection: new Connection(DEVNET_RPC_URL),
    candidate: buildCandidate(),
    config: CONFIG,
    feeClaimer: FEE_CLAIMER,
    quoteMint: QUOTE_MINT,
    payer: PAYER,
    ...overrides,
  };
}

describe("pinned Meteora config transaction builder", () => {
  it("builds one unsigned create_config instruction and declares the config signer", async () => {
    const result = await buildMeteoraConfigTransaction(buildInput());

    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") throw new Error("Expected a prepared config transaction");
    const createConfig = DynamicBondingCurveIdl.instructions.find(
      (instruction) => instruction.name === "create_config",
    );
    expect(createConfig).toBeDefined();
    expect(result).toMatchObject({
      sdkVersion: "1.5.13",
      configAddress: CONFIG.toBase58(),
      feePayer: PAYER.toBase58(),
      additionalSignerAddresses: [CONFIG.toBase58()],
      lockedLiquidityBpsAtDayOne: 1_000,
    });
    expect(result.transaction.feePayer?.equals(PAYER)).toBe(true);
    expect(result.transaction.instructions).toHaveLength(1);
    expect(result.transaction.instructions[0]?.programId.toBase58()).toBe(
      "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    );
    expect(result.transaction.instructions[0]?.data.subarray(0, 8)).toEqual(
      Buffer.from(createConfig?.discriminator ?? []),
    );
    expect(
      result.transaction.instructions[0]?.keys.some(
        (account) => account.pubkey.equals(CONFIG) && account.isSigner && account.isWritable,
      ),
    ).toBe(true);
    expect(
      result.transaction.instructions[0]?.keys.some(
        (account) => account.pubkey.equals(PAYER) && account.isSigner && account.isWritable,
      ),
    ).toBe(true);
    expect(result.transaction.signatures.every((signature) => signature.signature === null)).toBe(
      true,
    );
  });

  it("blocks invalid config input before transaction construction", async () => {
    const result = await buildMeteoraConfigTransaction(buildInput({ candidate: null }));

    expect(result).toMatchObject({
      status: "blocked",
      stage: "configuration-validation",
      issues: [{ code: "complete_candidate_required" }],
    });
  });

  it("rejects invalid or colliding config signer accounts", async () => {
    const defaultConfig = await buildMeteoraConfigTransaction(
      buildInput({ config: PublicKey.default }),
    );
    expect(defaultConfig).toMatchObject({
      status: "blocked",
      stage: "configuration-validation",
      issues: [{ path: "$.config", code: "invalid_config_signer" }],
    });

    const collidingAccounts = await buildMeteoraConfigTransaction(buildInput({ payer: CONFIG }));
    expect(collidingAccounts).toMatchObject({
      status: "blocked",
      stage: "configuration-validation",
      issues: [{ path: "$.config", code: "config_address_collision" }],
    });
  });

  it("refuses to build against a non-Devnet connection", async () => {
    const result = await buildMeteoraConfigTransaction(
      buildInput({ connection: new Connection("https://api.mainnet-beta.solana.com") }),
    );

    expect(result).toEqual({ status: "unavailable", code: "non_devnet_connection" });
  });
});
