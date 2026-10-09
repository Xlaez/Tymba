import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assessDeploymentBudget,
  type DeploymentBudgetResult,
} from "../meteora/deployment-budget.js";
import { recordExplicitDeploymentDecision } from "../meteora/deployment-approval-gate.js";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  validateDevnetGenesisHash,
  validateWalletAccount,
  walletSupportsDevnetLegacyTransaction,
} from "../meteora/deployment-preflight.js";
import {
  type DeploymentSimulationResult,
  simulateDeploymentTransaction,
} from "../meteora/deployment-preview.js";
import {
  sendApprovedDeployment,
  type WalletSendFeature,
  type WalletSubmissionResult,
} from "../meteora/deployment-wallet-sender.js";
import { DEMO_V1_METADATA_URI } from "../meteora/demo-v1-metadata.js";
import { postJson } from "./api.js";

type RegisteredWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
type WalletAccount = Parameters<WalletSendFeature["signAndSendTransaction"]>[0]["account"];
type WalletConnectFeature = {
  connect: (input: { silent: false }) => Promise<{ accounts: readonly unknown[] }>;
};
type WalletEventsFeature = {
  on: (event: "change", listener: (properties: unknown) => void) => () => void;
};
type DeploymentCandidateResult =
  | { status: "prepared"; candidate: string; candidateDigestHex: string }
  | { status: "blocked"; issues: readonly { code: string; message: string }[] };
type TransactionAssemblyResult =
  | {
      status: "prepared";
      candidate: string;
      candidateDigestHex: string;
      transactionBase64: string;
      feePayer: string;
      configAddress: string;
      baseMintAddress: string;
      poolAddress: string;
      baseVaultAddress: string;
      quoteVaultAddress: string;
      metadataAddress: string;
      quoteMintAddress: string;
      quoteDecimals: number;
      additionalSignerAddresses: readonly string[];
      rentAccounts: readonly { address: string; dataLength: number }[];
      additionalLamportDebits: readonly string[];
      sdkVersion: string;
      rentLayoutEvidence: string;
    }
  | { status: "blocked"; issues: readonly { code: string; message: string }[] };
type SendReady = {
  status: "ready";
  candidateId: string;
  walletAddress: string;
  messageDigestHex: string;
  broadcast: "not-invoked";
};
type DeploymentReadinessResult =
  | SendReady
  | {
      status: "blocked";
      reasons?: readonly string[];
      issues?: readonly { code: string; message: string }[];
    };
type PreparedTransaction = {
  candidate: unknown;
  candidateDigestHex: string;
  transaction: Transaction;
  configAddress: string;
  baseMintAddress: string;
  poolAddress: string;
  baseVaultAddress: string;
  quoteVaultAddress: string;
  metadataAddress: string;
  quoteMintAddress: string;
  quoteDecimals: number;
  additionalSignerAddresses: readonly string[];
  rentAccounts: readonly { address: PublicKey; dataLength: number }[];
  additionalLamportDebits: readonly bigint[];
  rentLayoutEvidence: string;
  budget: DeploymentBudgetResult;
  simulation: DeploymentSimulationResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function lamports(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

function formatApiIssues(issues: readonly { code: string; message: string }[]): string {
  return issues.map(({ message }) => message).join(" ");
}

function formatReadinessBlock(result: Extract<DeploymentReadinessResult, { status: "blocked" }>) {
  const details = [
    ...(result.reasons ?? []),
    ...(result.issues ?? []).map(({ message }) => message),
  ];
  return details.length > 0
    ? `Deployment readiness blocked: ${details.join("; ")}`
    : "Deployment readiness was blocked without a reason. Prepare the transaction again and retry.";
}

function resultText(result: WalletSubmissionResult): string {
  switch (result.status) {
    case "confirmed":
      return `Transaction confirmed in slot ${result.slot}.`;
    case "confirmed-failed":
      return `The transaction landed and failed in slot ${result.slot}. Do not retry without reviewing the signature.`;
    case "submitted-unconfirmed":
      return "A signature was returned, but confirmation could not be fetched. Do not retry; check the signature on Explorer.";
    case "outcome-unknown":
      return "The wallet outcome is unknown. Do not retry until the wallet and Devnet history have been checked.";
    case "preflight-rejected":
      return "Brave Wallet could not find the prepared blockhash during preflight simulation. Prepare and simulate a fresh transaction, then review it again.";
    case "failed-before-wallet":
      return "Runtime transaction signing failed before the connected wallet was asked to approve.";
    case "blocked":
      return `Submission was blocked by the deployment gate (${result.code}).`;
  }
}

export function DeploymentAccess(props: { compileRequest: unknown; candidateId: string }) {
  const [wallets, setWallets] = useState<RegisteredWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<RegisteredWallet | null>(null);
  const [walletAccount, setWalletAccount] = useState<WalletAccount | null>(null);
  const [networkStatus, setNetworkStatus] = useState<
    "unchecked" | "checking" | "verified" | "failed"
  >("unchecked");
  const [networkMessage, setNetworkMessage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletMessage, setWalletMessage] = useState("");
  const [walletEventsMonitored, setWalletEventsMonitored] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [candidateResult, setCandidateResult] = useState<DeploymentCandidateResult | null>(null);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [metadataUri, setMetadataUri] = useState("");
  const [deploymentError, setDeploymentError] = useState("");
  const [deploymentBusy, setDeploymentBusy] = useState(false);
  const [sendProgress, setSendProgress] = useState("");
  const [prepared, setPrepared] = useState<PreparedTransaction | null>(null);
  const [approved, setApproved] = useState(false);
  const [submission, setSubmission] = useState<WalletSubmissionResult | null>(null);
  const connectedAddress = useRef<string | null>(null);
  const connectedAccount = useRef<WalletAccount | null>(null);
  const runtimeSigners = useRef<readonly Keypair[] | null>(null);
  const connection = useRef<Connection | null>(null);

  const clearPrepared = useCallback(() => {
    for (const signer of runtimeSigners.current ?? []) signer.secretKey.fill(0);
    runtimeSigners.current = null;
    setPrepared(null);
    setApproved(false);
    setDeploymentError("");
  }, []);

  useEffect(
    () => () => {
      for (const signer of runtimeSigners.current ?? []) signer.secretKey.fill(0);
      runtimeSigners.current = null;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setCandidateBusy(true);
    setCandidateResult(null);
    clearPrepared();
    void postJson<DeploymentCandidateResult>("/api/deployment/candidate", {
      compileRequest: props.compileRequest,
      candidateId: props.candidateId,
    })
      .then((result) => {
        if (active) setCandidateResult(result);
      })
      .catch((failure) => {
        if (active)
          setCandidateResult({
            status: "blocked",
            issues: [
              {
                code: "candidate_request_failed",
                message:
                  failure instanceof Error ? failure.message : "Candidate preparation failed.",
              },
            ],
          });
      })
      .finally(() => {
        if (active) setCandidateBusy(false);
      });
    return () => {
      active = false;
    };
  }, [props.compileRequest, props.candidateId, clearPrepared]);

  useEffect(() => {
    const walletApi = getWallets();
    setWallets([...walletApi.get()]);
    const unregister = walletApi.on("unregister", () => {
      setWallets([...walletApi.get()]);
      setSelectedWallet(null);
      setWalletAccount(null);
      connectedAccount.current = null;
      connectedAddress.current = null;
      setWalletAddress("");
      setWalletEventsMonitored(false);
      clearPrepared();
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
  }, [clearPrepared]);

  useEffect(() => {
    if (!selectedWallet) return;
    const events = selectedWallet.features["standard:events"];
    if (!isRecord(events) || typeof events.on !== "function") return;
    try {
      const unsubscribe = (events as unknown as WalletEventsFeature).on("change", () => {
        connectedAccount.current = null;
        connectedAddress.current = null;
        setWalletAccount(null);
        setWalletAddress("");
        clearPrepared();
        setWalletMessage("The wallet account or network changed. Connect again to recheck it.");
      });
      if (typeof unsubscribe !== "function")
        throw new Error("Wallet change notifications unavailable.");
      setWalletEventsMonitored(true);
      return unsubscribe;
    } catch {
      setWalletEventsMonitored(false);
      connectedAccount.current = null;
      connectedAddress.current = null;
      setWalletAccount(null);
      setWalletAddress("");
      clearPrepared();
      setWalletMessage("This wallet could not provide account change notifications.");
    }
  }, [selectedWallet, clearPrepared]);

  async function checkNetwork() {
    setNetworkStatus("checking");
    setNetworkMessage("");
    clearPrepared();
    try {
      const genesisHash = await new Connection(DEVNET_RPC_URL, "confirmed").getGenesisHash();
      if (validateDevnetGenesisHash(genesisHash)) {
        setNetworkStatus("verified");
        setNetworkMessage("The fixed Solana RPC endpoint identified itself as Devnet.");
      } else {
        setNetworkStatus("failed");
        setNetworkMessage(
          `The RPC endpoint ${DEVNET_RPC_URL} returned genesis hash ${genesisHash}; expected ${DEVNET_GENESIS_HASH}. No transaction was sent.`,
        );
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
    clearPrepared();
    setWalletAddress("");
    setWalletAccount(null);
    connectedAccount.current = null;
    connectedAddress.current = null;
    setWalletMessage("");
    try {
      const rawFeature = selectedWallet.features["standard:connect"];
      if (!isRecord(rawFeature) || typeof rawFeature.connect !== "function") {
        setWalletMessage("This wallet does not provide a supported connection method.");
        return;
      }
      const result = await (rawFeature as unknown as WalletConnectFeature).connect({
        silent: false,
      });
      const accepted = result.accounts.find(
        (account) => validateWalletAccount(account, selectedWallet).status === "valid",
      );
      if (!accepted) {
        setWalletMessage(
          "The wallet did not return a valid Solana Devnet account with legacy signing support.",
        );
        return;
      }
      const validation = validateWalletAccount(accepted, selectedWallet);
      if (validation.status !== "valid") {
        setWalletMessage("The wallet account could not be validated for Devnet.");
        return;
      }
      const account = accepted as WalletAccount;
      setWalletAccount(account);
      connectedAccount.current = account;
      connectedAddress.current = validation.address;
      setWalletAddress(validation.address);
      setWalletMessage("Connected public account validated for Devnet and legacy transactions.");
    } catch {
      setWalletMessage("The wallet connection was cancelled or failed. No account was accepted.");
    } finally {
      setConnecting(false);
    }
  }

  async function assembleAndSimulate() {
    if (
      candidateResult?.status !== "prepared" ||
      !walletAccount ||
      !walletAddress ||
      networkStatus !== "verified" ||
      metadataUri.trim().length === 0
    )
      return;
    setDeploymentBusy(true);
    setDeploymentError("");
    clearPrepared();
    try {
      const signers = [Keypair.generate(), Keypair.generate()] as const;
      runtimeSigners.current = signers;
      const result = await postJson<TransactionAssemblyResult>("/api/deployment/transaction", {
        compileRequest: props.compileRequest,
        candidateId: props.candidateId,
        walletAddress,
        metadataUri: metadataUri.trim(),
        configAddress: signers[0].publicKey.toBase58(),
        baseMintAddress: signers[1].publicKey.toBase58(),
      });
      if (result.status !== "prepared") throw new Error(formatApiIssues(result.issues));
      const transaction = Transaction.from(decodeBase64(result.transactionBase64));
      if (
        result.configAddress !== signers[0].publicKey.toBase58() ||
        result.baseMintAddress !== signers[1].publicKey.toBase58() ||
        result.feePayer !== walletAddress
      )
        throw new Error("Prepared signer addresses did not match the runtime keys in memory.");
      const rpc = new Connection(DEVNET_RPC_URL, "confirmed");
      connection.current = rpc;
      const additionalSigners = result.additionalSignerAddresses.map(
        (address) => new PublicKey(address),
      );
      const rentAccounts = result.rentAccounts.map((account) => ({
        address: new PublicKey(account.address),
        dataLength: account.dataLength,
      }));
      const budget = await assessDeploymentBudget({
        connection: rpc,
        transaction,
        feePayer: new PublicKey(walletAddress),
        additionalSigners,
        accountsToCreate: rentAccounts,
        additionalLamportDebits: result.additionalLamportDebits.map((amount) => BigInt(amount)),
      });
      if (budget.status !== "sufficient") {
        const reason =
          budget.status === "unavailable"
            ? budget.code
            : budget.status === "invalid"
              ? budget.code
              : "insufficient_balance";
        throw new Error(`Devnet budget check did not pass (${reason}).`);
      }
      const simulation = await simulateDeploymentTransaction({
        connection: rpc,
        transaction,
        feePayer: new PublicKey(walletAddress),
        additionalSigners,
        budget,
      });
      if (simulation.status !== "complete" || simulation.simulation.status !== "succeeded") {
        const reason =
          simulation.status === "complete" ? simulation.simulation.status : simulation.status;
        throw new Error(`Unsigned transaction simulation did not pass (${reason}).`);
      }
      setPrepared({
        candidate: JSON.parse(result.candidate) as unknown,
        candidateDigestHex: result.candidateDigestHex,
        transaction,
        configAddress: result.configAddress,
        baseMintAddress: result.baseMintAddress,
        poolAddress: result.poolAddress,
        baseVaultAddress: result.baseVaultAddress,
        quoteVaultAddress: result.quoteVaultAddress,
        metadataAddress: result.metadataAddress,
        quoteMintAddress: result.quoteMintAddress,
        quoteDecimals: result.quoteDecimals,
        additionalSignerAddresses: result.additionalSignerAddresses,
        rentAccounts,
        additionalLamportDebits: result.additionalLamportDebits.map((amount) => BigInt(amount)),
        rentLayoutEvidence: result.rentLayoutEvidence,
        budget,
        simulation,
      });
    } catch (failure) {
      for (const signer of runtimeSigners.current ?? []) signer.secretKey.fill(0);
      runtimeSigners.current = null;
      setDeploymentError(
        failure instanceof Error ? failure.message : "Transaction preparation failed.",
      );
    } finally {
      setDeploymentBusy(false);
    }
  }

  async function approveAndSend() {
    const blockedReason = getSendBlockedReason();
    if (blockedReason) {
      setDeploymentError(blockedReason);
      return;
    }
    if (!prepared || !walletAccount || !walletAddress || !connection.current) {
      setDeploymentError(
        "The prepared transaction or connected wallet is no longer available. Prepare it again.",
      );
      return;
    }
    const simulation = prepared.simulation;
    const budget = prepared.budget;
    if (
      simulation.status !== "complete" ||
      simulation.simulation.status !== "succeeded" ||
      budget.status !== "sufficient"
    ) {
      setDeploymentError(
        "The transaction no longer has a successful simulation and sufficient balance. Prepare it again.",
      );
      return;
    }
    setDeploymentBusy(true);
    setDeploymentError("");
    setSendProgress("Recording approval and rechecking Devnet readiness…");
    try {
      const decision = recordExplicitDeploymentDecision({
        decision: "approve",
        preview: simulation.preview,
        approverAddress: walletAddress,
        recordedAtSeconds: BigInt(Math.floor(Date.now() / 1000)),
      });
      if (decision.status !== "recorded")
        throw new Error("The explicit approval record was invalid.");
      const readiness = await postJson<DeploymentReadinessResult>("/api/deployment/readiness", {
        candidate: prepared.candidate,
        connectedWalletPublicKey: walletAddress,
        transactionMessageDigestHex: simulation.preview.messageDigestHex,
        preflight: { status: "sufficient", messageDigestHex: budget.evidence.messageDigestHex },
        simulation: { status: "succeeded", messageDigestHex: simulation.preview.messageDigestHex },
        approval: {
          status: decision.approval.status,
          approverAddress: decision.approval.approverAddress,
          messageDigestHex: decision.approval.messageDigestHex,
        },
      });
      if (readiness.status !== "ready") throw new Error(formatReadinessBlock(readiness));
      const rawFeature = selectedWallet?.features[SolanaSignAndSendTransaction];
      const accountNow = connectedAccount.current;
      if (
        !isRecord(rawFeature) ||
        typeof rawFeature.signAndSendTransaction !== "function" ||
        !accountNow
      )
        throw new Error("The connected wallet no longer exposes its validated send account.");
      setSendProgress("Opening Brave Wallet for final signing approval…");
      const result = await sendApprovedDeployment({
        approval: decision.approval,
        readiness,
        transaction: prepared.transaction,
        preview: simulation.preview,
        connection: connection.current,
        getConnectedWalletAddress: () => connectedAddress.current,
        walletAccount: accountNow,
        walletFeature: rawFeature as unknown as WalletSendFeature,
        additionalSigners: runtimeSigners.current ?? [],
      });
      setSubmission(result);
      for (const signer of runtimeSigners.current ?? []) signer.secretKey.fill(0);
      runtimeSigners.current = null;
    } catch (failure) {
      setDeploymentError(
        failure instanceof Error ? failure.message : "Approved send could not proceed.",
      );
    } finally {
      setDeploymentBusy(false);
      setSendProgress("");
    }
  }

  function getSendBlockedReason(): string | null {
    if (!prepared || !preview) return "Prepare and simulate the transaction before sending.";
    if (!accessReady) return "Confirm Devnet and reconnect the wallet before sending.";
    if (!walletAccount || !walletAddress || !connectedAccount.current)
      return "The connected wallet account is unavailable. Reconnect the wallet before sending.";
    if (!connection.current)
      return "The Devnet connection is unavailable. Prepare the transaction again.";
    if (!approved) return "Check the approval box before sending this transaction.";
    if (
      prepared.simulation.status !== "complete" ||
      prepared.simulation.simulation.status !== "succeeded"
    )
      return "A successful simulation is required before sending.";
    if (prepared.budget.status !== "sufficient")
      return "A sufficient Devnet balance is required before sending.";
    const walletFeature = selectedWallet?.features[SolanaSignAndSendTransaction];
    if (!isRecord(walletFeature) || typeof walletFeature.signAndSendTransaction !== "function")
      return "The selected wallet does not currently expose transaction signing.";
    if (deploymentBusy) return "The transaction is already being processed.";
    if (submission !== null) return "This transaction already has a submission result.";
    return null;
  }

  const accessReady =
    networkStatus === "verified" && walletAddress.length > 0 && walletEventsMonitored;
  const preview = prepared?.simulation.status === "complete" ? prepared.simulation.preview : null;
  const signature = submission && "signature" in submission ? submission.signature : null;

  return (
    <section className="panel" aria-labelledby="deployment-access-title">
      <div className="section-heading">
        <span className="step">8</span>
        <div>
          <span className="eyebrow">SEE THE COSTS BEFORE SENDING</span>
          <h2 id="deployment-access-title">Deploy the reviewed demo to Devnet</h2>
          <p>
            Candidate preparation is offline. Transaction setup reads Devnet. Your wallet signs only
            after you review the exact transaction below.
          </p>
        </div>
      </div>
      <section aria-labelledby="candidate-preparation-title">
        <h3 id="candidate-preparation-title">1. Complete demo candidate</h3>
        {candidateBusy && <output>Preparing the seeded demo candidate offline…</output>}
        {candidateResult?.status === "prepared" && (
          <div>
            <p>
              Profile <code>demo-v1</code> · Devnet · pinned candidate schema 1
            </p>
            <p>
              Candidate digest <code>{candidateResult.candidateDigestHex}</code>
            </p>
            <p className="muted">
              This candidate carries the seeded demo economics and unresolved runtime wallet and
              metadata requirements. It contains no private key or signing material.
            </p>
            <details>
              <summary>Inspect complete candidate JSON</summary>
              <pre>{candidateResult.candidate}</pre>
            </details>
          </div>
        )}
        {candidateResult?.status === "blocked" && (
          <output role="alert">{formatApiIssues(candidateResult.issues)}</output>
        )}
      </section>
      <section aria-labelledby="devnet-access-title">
        <h3 id="devnet-access-title">2. Confirm network and wallet</h3>
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
              clearPrepared();
              setSelectedWallet(wallets[Number(event.target.value)] ?? null);
              setWalletAccount(null);
              connectedAccount.current = null;
              connectedAddress.current = null;
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
        {walletAddress && (
          <p>
            Connected public address: <code>{walletAddress}</code>
          </p>
        )}
        {!wallets.length && (
          <output>No Wallet Standard wallet is available in this browser.</output>
        )}
        <output className={`result-status${accessReady ? "" : " partial"}`} aria-live="polite">
          {accessReady
            ? "Devnet and wallet checks passed."
            : networkStatus !== "verified"
              ? networkStatus === "checking"
                ? "Checking the Devnet connection. Transaction preparation will unlock after it passes."
                : "Click Check Devnet connection to confirm the network before preparing a transaction."
              : !walletAddress
                ? "Connect a compatible wallet to enable transaction preparation."
                : "Wallet account-change monitoring is required before transaction preparation."}
        </output>
      </section>
      <section aria-labelledby="transaction-preparation-title">
        <h3 id="transaction-preparation-title">3. Publish metadata and prepare the transaction</h3>
        <label className="deployment-metadata-label" htmlFor="deployment-metadata-uri">
          Published metadata JSON URL
        </label>
        <input
          id="deployment-metadata-uri"
          type="url"
          value={metadataUri}
          onChange={(event) => {
            clearPrepared();
            setMetadataUri(event.target.value);
          }}
          placeholder={DEMO_V1_METADATA_URI}
          autoComplete="off"
        />
        <p className="muted">
          Published fixture:{" "}
          <a href={DEMO_V1_METADATA_URI} target="_blank" rel="noreferrer">
            {DEMO_V1_METADATA_URI}
          </a>
          . Enter or choose it explicitly; the unresolved candidate placeholder is never sent.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => setMetadataUri(DEMO_V1_METADATA_URI)}
          disabled={candidateResult?.status !== "prepared" || deploymentBusy}
        >
          Use published demo metadata
        </button>
        <p className="muted">
          Preparing creates temporary config and token-mint signer keys in this page's memory,
          builds an unsigned transaction, checks wallet SOL and rent, then simulates it. Keys are
          not saved or sent to the local API.
        </p>
        <button
          type="button"
          onClick={() => void assembleAndSimulate()}
          disabled={
            !accessReady ||
            candidateResult?.status !== "prepared" ||
            !metadataUri.trim() ||
            deploymentBusy ||
            submission !== null
          }
        >
          {deploymentBusy && !submission
            ? "Preparing and simulating…"
            : "Prepare and simulate unsigned transaction"}
        </button>
      </section>
      {deploymentError && !prepared && <output role="alert">{deploymentError}</output>}
      {prepared && preview && (
        <section className="deployment-review" aria-labelledby="deployment-preview-title">
          <h3 id="deployment-preview-title">4. Review exact Devnet transaction</h3>
          <dl className="deployment-summary">
            <dt>Network</dt>
            <dd>Solana Devnet · {DEVNET_RPC_URL}</dd>
            <dt>Fee payer</dt>
            <dd>
              <code>{preview.feePayer}</code>
            </dd>
            <dt>Config</dt>
            <dd>
              <code>{prepared.configAddress}</code>
            </dd>
            <dt>Base token mint</dt>
            <dd>
              <code>{prepared.baseMintAddress}</code>
            </dd>
            <dt>Pool</dt>
            <dd>
              <code>{prepared.poolAddress}</code>
            </dd>
            <dt>Quote mint</dt>
            <dd>
              <code>{prepared.quoteMintAddress}</code> · {prepared.quoteDecimals} decimals
            </dd>
            <dt>Rent layout evidence</dt>
            <dd>{prepared.rentLayoutEvidence}</dd>
            <dt>Network fee</dt>
            <dd>{lamports(preview.budget.networkFeeLamports)} SOL</dd>
            <dt>Account rent</dt>
            <dd>
              {lamports(preview.budget.accountRentLamports)} SOL across{" "}
              {prepared.rentAccounts.length} new accounts
            </dd>
            <dt>Additional SOL debits</dt>
            <dd>{lamports(preview.budget.additionalLamportDebits)} SOL</dd>
            <dt>Total required</dt>
            <dd>{lamports(preview.budget.totalRequiredLamports)} SOL</dd>
            <dt>Remaining balance</dt>
            <dd>{lamports(preview.budget.remainingLamports)} SOL</dd>
            <dt>Simulation</dt>
            <dd>
              {prepared.simulation.status === "complete"
                ? prepared.simulation.simulation.status
                : prepared.simulation.status}
            </dd>
            <dt>Message digest</dt>
            <dd>
              <code>{preview.messageDigestHex}</code>
            </dd>
          </dl>
          <h4>Instructions</h4>
          <ol className="deployment-instructions">
            {preview.instructions.map((instruction) => {
              const signers = [
                ...new Set(
                  instruction.accounts
                    .filter((account) => account.isSigner)
                    .map((account) => account.address),
                ),
              ];
              return (
                <li key={`${instruction.index}-${instruction.programId}`}>
                  <strong>
                    {instruction.instructionLabel ?? instruction.programLabel}
                    {instruction.instructionName ? ` · ${instruction.instructionName}` : ""}
                  </strong>
                  {signers.length > 0 && (
                    <div className="deployment-instruction-signers">
                      Required signers:{" "}
                      {signers.map((address) => (
                        <code key={address}>{address}</code>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {prepared.additionalSignerAddresses.length > 0 && (
            <div className="deployment-temporary-signers">
              <strong>Temporary signers for this transaction</strong>
              <ul>
                {prepared.additionalSignerAddresses.map((address) => (
                  <li key={address}>
                    <code>{address}</code>
                  </li>
                ))}
              </ul>
              <p>Signing keys stay in this page's memory and are cleared after use.</p>
            </div>
          )}
          <div className="deployment-approval">
            {deploymentError && (
              <output className="deployment-send-error" role="alert">
                {deploymentError}
              </output>
            )}
            <label className="confirmation" htmlFor="deployment-explicit-approval">
              <input
                id="deployment-explicit-approval"
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>
                <strong>Approve this exact transaction</strong>
                <br />I reviewed the addresses, instructions, costs, and successful simulation for
                Devnet.
              </span>
            </label>
            <button
              className="deployment-send-button"
              type="button"
              onClick={() => void approveAndSend()}
              disabled={getSendBlockedReason() !== null}
              aria-describedby="deployment-send-help"
            >
              {deploymentBusy ? "Processing approval…" : "Approve and send on Devnet"}
            </button>
            <p className="muted deployment-send-help" id="deployment-send-help" aria-live="polite">
              {deploymentBusy
                ? sendProgress || "Checking the approved transaction…"
                : (getSendBlockedReason() ??
                  "Click to record approval and open your connected wallet for signing. Nothing is sent until you approve it in the wallet.")}
            </p>
          </div>
          <p className="muted">
            Rent sizes follow current Meteora and Metaplex source layouts. Devnet account-layout
            parity has not yet been independently verified on-chain.
          </p>
        </section>
      )}
      {submission && (
        <section aria-labelledby="submission-result-title">
          <h3 id="submission-result-title">Submission result</h3>
          <output role={submission.status === "confirmed" ? "status" : "alert"}>
            {resultText(submission)}
          </output>
          {signature && (
            <p>
              Signature: <code>{signature}</code>
            </p>
          )}
          {signature && (
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction on Solana Explorer
            </a>
          )}
          <p className="muted">
            A confirmation is not on-chain parity verification. The deployment record and
            fetched-state verification remain separate steps.
          </p>
          {(submission.status === "blocked" ||
            submission.status === "failed-before-wallet" ||
            submission.status === "preflight-rejected") && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSubmission(null);
                clearPrepared();
              }}
            >
              Prepare a fresh transaction
            </button>
          )}
        </section>
      )}
      <p className="muted">
        Changing the wallet account clears candidate transaction evidence and runtime signers. No
        wallet signing material is stored in browser storage, reports, or API requests. Expected
        Devnet identity: {DEVNET_GENESIS_HASH}. No transaction is sent during candidate preparation
        or simulation.
      </p>
    </section>
  );
}
