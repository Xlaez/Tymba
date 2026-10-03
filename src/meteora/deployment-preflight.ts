import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";
import { PublicKey } from "@solana/web3.js";

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";
export const SOLANA_DEVNET_CHAIN = "solana:devnet";

type UnknownRecord = Record<string, unknown>;

export type WalletValidation =
  | { status: "valid"; address: string }
  | {
      status: "invalid";
      reason:
        | "unsupported-network"
        | "wallet-cannot-connect"
        | "wallet-change-events-unavailable"
        | "legacy-signing-unavailable"
        | "invalid-public-key"
        | "account-key-mismatch"
        | "wallet-account-not-on-curve";
    };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes(value: unknown, item: string): boolean {
  return Array.isArray(value) && value.includes(item);
}

function supportsLegacySigning(features: unknown, accountFeatures?: unknown): boolean {
  if (!isRecord(features)) return false;
  const supported = [SolanaSignTransaction, SolanaSignAndSendTransaction].some((name) => {
    const feature = features[name];
    if (!isRecord(feature) || !Array.isArray(feature.supportedTransactionVersions)) return false;
    const method = name === SolanaSignTransaction ? "signTransaction" : "signAndSendTransaction";
    return (
      feature.supportedTransactionVersions.includes("legacy") &&
      typeof feature[method] === "function" &&
      (accountFeatures === undefined || includes(accountFeatures, name))
    );
  });
  return supported;
}

function supportsWalletChangeEvents(features: unknown): boolean {
  if (!isRecord(features)) return false;
  const eventFeature = features["standard:events"];
  return isRecord(eventFeature) && typeof eventFeature.on === "function";
}

export function walletSupportsDevnetLegacyTransaction(wallet: unknown): boolean {
  if (!isRecord(wallet)) return false;
  if (!includes(wallet.chains, SOLANA_DEVNET_CHAIN)) return false;
  if (!isRecord(wallet.features)) return false;
  const connectFeature = wallet.features["standard:connect"];
  return (
    isRecord(connectFeature) &&
    typeof connectFeature.connect === "function" &&
    supportsWalletChangeEvents(wallet.features) &&
    supportsLegacySigning(wallet.features)
  );
}

export function validateDevnetGenesisHash(hash: string): boolean {
  return hash === DEVNET_GENESIS_HASH;
}

export function validateWalletAccount(account: unknown, wallet: unknown): WalletValidation {
  if (!isRecord(wallet) || !isRecord(account))
    return { status: "invalid", reason: "wallet-cannot-connect" };
  if (
    !includes(wallet.chains, SOLANA_DEVNET_CHAIN) ||
    !includes(account.chains, SOLANA_DEVNET_CHAIN)
  )
    return { status: "invalid", reason: "unsupported-network" };
  const features = wallet.features;
  const connectFeature = isRecord(features) ? features["standard:connect"] : undefined;
  if (!isRecord(connectFeature) || typeof connectFeature.connect !== "function")
    return { status: "invalid", reason: "wallet-cannot-connect" };
  if (!supportsWalletChangeEvents(features))
    return { status: "invalid", reason: "wallet-change-events-unavailable" };
  if (!supportsLegacySigning(features, account.features))
    return { status: "invalid", reason: "legacy-signing-unavailable" };
  if (typeof account.address !== "string" || !(account.publicKey instanceof Uint8Array))
    return { status: "invalid", reason: "invalid-public-key" };

  try {
    if (account.publicKey.length !== 32) return { status: "invalid", reason: "invalid-public-key" };
    const keyFromAddress = new PublicKey(account.address);
    const keyFromBytes = new PublicKey(account.publicKey);
    if (keyFromAddress.toBase58() !== account.address)
      return { status: "invalid", reason: "invalid-public-key" };
    if (!keyFromAddress.equals(keyFromBytes))
      return { status: "invalid", reason: "account-key-mismatch" };
    if (!PublicKey.isOnCurve(keyFromBytes))
      return { status: "invalid", reason: "wallet-account-not-on-curve" };
    return { status: "valid", address: keyFromAddress.toBase58() };
  } catch {
    return { status: "invalid", reason: "invalid-public-key" };
  }
}
