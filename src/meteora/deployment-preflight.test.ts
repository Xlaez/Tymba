import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  DEVNET_GENESIS_HASH,
  validateDevnetGenesisHash,
  validateWalletAccount,
  walletSupportsDevnetLegacyTransaction,
} from "./deployment-preflight.js";

function publicKeyBytes(start: number, onCurve: boolean): Uint8Array {
  for (let value = start; value < start + 256; value += 1) {
    const bytes = new Uint8Array(32).fill(value % 256);
    if (PublicKey.isOnCurve(bytes) === onCurve) return bytes;
  }
  throw new Error("Could not find a public-key fixture with the requested curve property.");
}

function walletFixture() {
  return {
    version: "1.0.0",
    name: "Fixture wallet",
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signTransaction: async () => [],
      },
    },
  };
}

function accountFixture(bytes: Uint8Array) {
  return {
    address: new PublicKey(bytes).toBase58(),
    publicKey: bytes,
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  };
}

describe("deployment network and wallet preflight", () => {
  it("accepts only the pinned Solana Devnet genesis hash", () => {
    expect(validateDevnetGenesisHash(DEVNET_GENESIS_HASH)).toBe(true);
    expect(validateDevnetGenesisHash("mainnet-genesis-hash")).toBe(false);
    expect(validateDevnetGenesisHash("")).toBe(false);
  });

  it("accepts a matching Devnet account with legacy transaction signing", () => {
    const account = accountFixture(publicKeyBytes(1, true));
    expect(walletSupportsDevnetLegacyTransaction(walletFixture())).toBe(true);
    expect(validateWalletAccount(account, walletFixture())).toEqual({
      status: "valid",
      address: account.address,
    });
  });

  it("rejects accounts or wallets that do not support Devnet", () => {
    const account = { ...accountFixture(publicKeyBytes(1, true)), chains: ["solana:mainnet"] };
    expect(validateWalletAccount(account, walletFixture())).toEqual({
      status: "invalid",
      reason: "unsupported-network",
    });
    expect(
      validateWalletAccount(accountFixture(publicKeyBytes(1, true)), {
        ...walletFixture(),
        chains: ["solana:mainnet"],
      }),
    ).toEqual({ status: "invalid", reason: "unsupported-network" });
  });

  it("requires a matching on-curve public key", () => {
    const account = accountFixture(publicKeyBytes(1, true));
    expect(
      validateWalletAccount({ ...account, publicKey: publicKeyBytes(2, true) }, walletFixture()),
    ).toEqual({ status: "invalid", reason: "account-key-mismatch" });
    expect(
      validateWalletAccount(accountFixture(publicKeyBytes(3, false)), walletFixture()),
    ).toEqual({ status: "invalid", reason: "wallet-account-not-on-curve" });
    expect(
      validateWalletAccount({ ...account, publicKey: new Uint8Array(31) }, walletFixture()),
    ).toEqual({ status: "invalid", reason: "invalid-public-key" });
  });

  it("requires legacy signing support on both the wallet and account", () => {
    const account = accountFixture(publicKeyBytes(1, true));
    const wallet = walletFixture();
    const unsupported = {
      ...wallet,
      features: {
        ...wallet.features,
        "solana:signTransaction": {
          ...wallet.features["solana:signTransaction"],
          supportedTransactionVersions: [0],
        },
      },
    };
    expect(walletSupportsDevnetLegacyTransaction(unsupported)).toBe(false);
    expect(validateWalletAccount(account, unsupported)).toEqual({
      status: "invalid",
      reason: "legacy-signing-unavailable",
    });
    expect(validateWalletAccount({ ...account, features: [] }, wallet)).toEqual({
      status: "invalid",
      reason: "legacy-signing-unavailable",
    });
  });

  it("requires account change notifications before access can be validated", () => {
    const wallet = walletFixture();
    const noEvents = {
      ...wallet,
      features: {
        "standard:connect": wallet.features["standard:connect"],
        "solana:signTransaction": wallet.features["solana:signTransaction"],
      },
    };
    expect(walletSupportsDevnetLegacyTransaction(noEvents)).toBe(false);
    expect(validateWalletAccount(accountFixture(publicKeyBytes(1, true)), noEvents)).toEqual({
      status: "invalid",
      reason: "wallet-change-events-unavailable",
    });
  });
});
