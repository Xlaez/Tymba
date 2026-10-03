import { Connection } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import { useEffect, useState } from "react";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  validateDevnetGenesisHash,
  validateWalletAccount,
  walletSupportsDevnetLegacyTransaction,
} from "../meteora/deployment-preflight.js";

type RegisteredWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
type WalletConnectFeature = {
  connect: (input: { silent: false }) => Promise<{ accounts: readonly unknown[] }>;
};
type WalletEventsFeature = {
  on: (event: "change", listener: (properties: unknown) => void) => () => void;
};

const walletReason: Record<string, string> = {
  "unsupported-network": "This account is not enabled for Solana Devnet.",
  "wallet-cannot-connect": "This wallet does not provide a supported connection method.",
  "wallet-change-events-unavailable":
    "This wallet cannot notify this page when its account changes.",
  "legacy-signing-unavailable":
    "This account does not support the transaction format needed for this step.",
  "invalid-public-key": "The wallet returned an invalid public address.",
  "account-key-mismatch": "The wallet address did not match its public key.",
  "wallet-account-not-on-curve": "This address cannot sign as a Solana wallet account.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function DeploymentAccess() {
  const [wallets, setWallets] = useState<RegisteredWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<RegisteredWallet | null>(null);
  const [networkStatus, setNetworkStatus] = useState<
    "unchecked" | "checking" | "verified" | "failed"
  >("unchecked");
  const [networkMessage, setNetworkMessage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletMessage, setWalletMessage] = useState("");
  const [walletEventsMonitored, setWalletEventsMonitored] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const walletApi = getWallets();
    setWallets([...walletApi.get()]);
    const unregister = walletApi.on("unregister", () => {
      setWallets([...walletApi.get()]);
      setSelectedWallet(null);
      setWalletAddress("");
      setWalletEventsMonitored(false);
      setWalletMessage("The wallet was disconnected from this page. Connect again to continue.");
    });
    const register = walletApi.on("register", (...registered) => {
      setWallets((current) => {
        const next = [...current];
        for (const wallet of registered) if (!next.includes(wallet)) next.push(wallet);
        return next;
      });
    });
    return () => {
      unregister();
      register();
    };
  }, []);

  useEffect(() => {
    if (!selectedWallet) return;
    const events = selectedWallet.features["standard:events"];
    if (!isRecord(events) || typeof events.on !== "function") return;
    const feature = events as unknown as WalletEventsFeature;
    try {
      const unsubscribe = feature.on("change", () => {
        setWalletAddress("");
        setWalletMessage("The wallet account or network changed. Connect again to recheck it.");
      });
      if (typeof unsubscribe !== "function")
        throw new Error("Wallet account change notifications are unavailable.");
      setWalletEventsMonitored(true);
      return unsubscribe;
    } catch {
      setWalletEventsMonitored(false);
      setWalletAddress("");
      setWalletMessage("This wallet could not provide account change notifications.");
    }
  }, [selectedWallet]);

  async function checkNetwork() {
    setNetworkStatus("checking");
    setNetworkMessage("");
    try {
      const genesisHash = await new Connection(DEVNET_RPC_URL, "confirmed").getGenesisHash();
      if (validateDevnetGenesisHash(genesisHash)) {
        setNetworkStatus("verified");
        setNetworkMessage("The fixed Solana RPC endpoint identified itself as Devnet.");
      } else {
        setNetworkStatus("failed");
        setNetworkMessage("The RPC endpoint did not identify as Devnet. No transaction was sent.");
      }
    } catch {
      setNetworkStatus("failed");
      setNetworkMessage("Could not confirm the Devnet connection. Check the connection and retry.");
    }
  }

  async function connectWallet() {
    if (
      !selectedWallet ||
      !walletEventsMonitored ||
      !walletSupportsDevnetLegacyTransaction(selectedWallet)
    )
      return;
    setConnecting(true);
    setWalletAddress("");
    setWalletMessage("");
    try {
      const rawFeature = selectedWallet.features["standard:connect"];
      if (!isRecord(rawFeature) || typeof rawFeature.connect !== "function") {
        setWalletMessage("This wallet does not provide a supported connection method.");
        return;
      }
      const feature = rawFeature as unknown as WalletConnectFeature;
      const result = await feature.connect({ silent: false });
      const accepted = result.accounts.find((account) => {
        return validateWalletAccount(account, selectedWallet).status === "valid";
      });
      if (!accepted) {
        const first = result.accounts[0];
        const validation = validateWalletAccount(first, selectedWallet);
        setWalletMessage(
          validation.status === "invalid"
            ? (walletReason[validation.reason] ?? "The wallet account could not be validated.")
            : "The wallet did not return a Devnet account with compatible signing support.",
        );
        return;
      }
      const validation = validateWalletAccount(accepted, selectedWallet);
      if (validation.status !== "valid") {
        setWalletMessage(
          walletReason[validation.reason] ?? "The wallet account could not be validated.",
        );
        return;
      }
      setWalletAddress(validation.address);
      setWalletMessage("Connected public account validated for Devnet and legacy transactions.");
    } catch {
      setWalletMessage("The wallet connection was cancelled or failed. No account was accepted.");
    } finally {
      setConnecting(false);
    }
  }

  const ready = networkStatus === "verified" && walletAddress.length > 0 && walletEventsMonitored;

  return (
    <section className="panel" aria-labelledby="deployment-access-title">
      <div className="section-heading">
        <span className="step">8</span>
        <div>
          <span className="eyebrow">READ-ONLY SETUP CHECK</span>
          <h2 id="deployment-access-title">Devnet access check</h2>
          <p>
            Confirm the test network and connect your wallet. This prepares the later deployment
            checks.
          </p>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => void checkNetwork()}
          disabled={networkStatus === "checking"}
        >
          {networkStatus === "checking" ? "Checking Devnet…" : "Check Devnet connection"}
        </button>
        <label className="wallet-select-label" htmlFor="deployment-wallet">
          Wallet
        </label>
        <select
          id="deployment-wallet"
          value={selectedWallet ? String(wallets.indexOf(selectedWallet)) : ""}
          onChange={(event) => {
            setSelectedWallet(wallets[Number(event.target.value)] ?? null);
            setWalletAddress("");
            setWalletEventsMonitored(false);
            setWalletMessage("");
          }}
        >
          <option value="">Choose a wallet</option>
          {wallets.map((wallet, index) => (
            <option key={`${wallet.name}-${index}`} value={String(index)}>
              {wallet.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary"
          onClick={() => void connectWallet()}
          disabled={
            connecting ||
            !selectedWallet ||
            !walletEventsMonitored ||
            !walletSupportsDevnetLegacyTransaction(selectedWallet)
          }
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
      {networkMessage && (
        <p role={networkStatus === "failed" ? "alert" : "status"}>{networkMessage}</p>
      )}
      {walletMessage && <output>{walletMessage}</output>}
      {wallets.length === 0 && (
        <output>No Wallet Standard wallet is available in this browser.</output>
      )}
      {selectedWallet && !walletSupportsDevnetLegacyTransaction(selectedWallet) && (
        <output>
          This wallet does not support the test network, account change notifications, and
          transaction format needed here.
        </output>
      )}
      {walletAddress && (
        <p>
          Connected public address: <code>{walletAddress}</code>
        </p>
      )}
      <output className={`result-status${ready ? "" : " partial"}`} aria-live="polite">
        {ready
          ? "Network and wallet checks passed · configuration and balance checks are still pending."
          : "Preflight incomplete · verify Devnet and connect a compatible wallet."}
      </output>
      <p className="muted">
        This check reads the test network and public wallet account only. It does not build, sign,
        or send a transaction. Changing the wallet account clears its check. No wallet address is
        saved in a report or browser storage.
      </p>
      <details>
        <summary>Technical check details</summary>
        <p>
          The page checks the network identity at {DEVNET_RPC_URL} against the known Devnet value{" "}
          {DEVNET_GENESIS_HASH}. A compatible wallet must support the transaction format used by the
          pinned Meteora SDK and notify the page when its account changes. These checks do not
          validate a market configuration or confirm funds.
        </p>
      </details>
    </section>
  );
}
