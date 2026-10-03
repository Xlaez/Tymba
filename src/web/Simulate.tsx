import { Decimal } from "decimal.js";
import { useRef, useState } from "react";
import type { WebSimulationResponse, WebTradeInput } from "../web-api/contracts.js";
import { postJson } from "./api.js";
import { EvidenceNotice } from "./EvidenceNotice.js";

type EditableTrade = WebTradeInput & { id: number };
const script: readonly EditableTrade[] = [
  { id: 1, direction: "buy", amount: "5000", slot: "1", timestampSeconds: "1" },
  { id: 2, direction: "buy", amount: "10000", slot: "2", timestampSeconds: "2" },
  { id: 3, direction: "sell", amount: "1000000", slot: "3", timestampSeconds: "3" },
];

export function Simulate({
  compileRequest,
  candidateId,
  baseSymbol,
  quoteSymbol,
  onEvidenceChange,
}: {
  compileRequest: unknown;
  candidateId: string;
  baseSymbol: string;
  quoteSymbol: string;
  onEvidenceChange?: (trades: readonly WebTradeInput[] | null) => void;
}) {
  const [trades, setTrades] = useState<readonly EditableTrade[]>(script);
  const [result, setResult] = useState<WebSimulationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const nextId = useRef(4);

  function edit(next: readonly EditableTrade[]) {
    revision.current += 1;
    setTrades(next);
    setResult(null);
    setError("");
    setBusy(false);
    onEvidenceChange?.(null);
  }

  async function run() {
    const currentRevision = ++revision.current;
    setBusy(true);
    setError("");
    setResult(null);
    onEvidenceChange?.(null);
    try {
      const response = await postJson<WebSimulationResponse>("/api/simulate", {
        compileRequest,
        candidateId,
        trades: trades.map(({ id: _id, ...trade }) => trade),
      });
      if (revision.current === currentRevision) {
        setResult(response);
        onEvidenceChange?.(response.status === "failed" ? null : response.inputTrades);
      }
    } catch (failure) {
      if (revision.current === currentRevision)
        setError(failure instanceof Error ? failure.message : "Simulation failed.");
    } finally {
      if (revision.current === currentRevision) setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="simulate-title" aria-busy={busy}>
      <div className="section-heading">
        <span className="step">03</span>
        <div>
          <h2 id="simulate-title">Replay your trade plan</h2>
          <p>Same design and trade sequence, same modeled outcome.</p>
        </div>
      </div>
      <p className="muted">
        Each run starts at the selected draft’s configured initial state. Buy amounts are{" "}
        {quoteSymbol}; sell amounts are {baseSymbol}. Both clocks are explicit and must not go
        backwards. This is a pool script, not a wallet portfolio or a demand forecast.
      </p>
      <div className="trade-editor">
        {trades.map((trade, index) => (
          <fieldset key={trade.id} className="trade-row">
            <legend>Trade {index + 1}</legend>
            <label className="field">
              <span>Action</span>
              <select
                aria-label={`Trade ${index + 1} action`}
                value={trade.direction}
                onChange={(event) =>
                  edit(
                    trades.map((row) =>
                      row.id === trade.id
                        ? { ...row, direction: event.target.value === "sell" ? "sell" : "buy" }
                        : row,
                    ),
                  )
                }
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </label>
            {(["amount", "slot", "timestampSeconds"] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {key === "amount"
                    ? `Amount (${trade.direction === "buy" ? quoteSymbol : baseSymbol})`
                    : key === "slot"
                      ? "Slot"
                      : "Timestamp (seconds)"}
                </span>
                <input
                  aria-label={`Trade ${index + 1} ${key}`}
                  type="text"
                  inputMode="decimal"
                  value={trade[key]}
                  maxLength={256}
                  onChange={(event) =>
                    edit(
                      trades.map((row) =>
                        row.id === trade.id ? { ...row, [key]: event.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              type="button"
              className="secondary"
              aria-label={`Remove trade ${index + 1}`}
              onClick={() => edit(trades.filter((row) => row.id !== trade.id))}
            >
              Remove
            </button>
          </fieldset>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={trades.length >= 100}
          onClick={() =>
            edit([
              ...trades,
              {
                id: nextId.current++,
                direction: "buy",
                amount: "",
                slot: "",
                timestampSeconds: "",
              },
            ])
          }
        >
          Add trade
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            nextId.current = 4;
            edit(script);
          }}
        >
          Load demo script
        </button>
        <button type="button" onClick={() => void run()} disabled={busy || trades.length === 0}>
          {busy ? "Replaying trade plan…" : "Replay trade plan"}
        </button>
      </div>
      {busy && (
        <output aria-live="polite" className="workflow-state">
          Replaying exact actions and configured clocks…
        </output>
      )}
      {trades.length === 0 && (
        <p className="muted">The script is empty. Add a trade or load the demo script to run.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result?.status === "failed" && (
        <div role="alert" className="error">
          <strong>Script could not complete · no completed metrics</strong>
          <ul>
            {result.issues.map((issue) => (
              <li key={`${issue.path}-${issue.code}`}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && result.status !== "failed" && (
        <div data-testid="simulation-result">
          <output
            className={`result-status ${result.status === "partial" ? "partial" : "satisfied"}`}
          >
            {result.status === "partial"
              ? "Script completed with partial fills"
              : "Script completed"}
          </output>
          <EvidenceNotice stage="simulation" />
          <dl className="metrics">
            <dt>Final spot price</dt>
            <dd>
              {new Decimal(result.metrics.finalSpotPrice).toSignificantDigits(10).toString()}{" "}
              {quoteSymbol}/{baseSymbol}
            </dd>
            <dt>Net capital in curve</dt>
            <dd>
              {result.metrics.quoteAccumulated} {quoteSymbol}
            </dd>
            <dt>Net tokens distributed</dt>
            <dd>
              {result.metrics.baseDistributed} {baseSymbol}
            </dd>
            <dt>Share of supply distributed</dt>
            <dd>{result.metrics.baseDistributionPct}%</dd>
            <dt>Graduation progress</dt>
            <dd>{result.metrics.migrationProgressPct}%</dd>
            <dt>Maximum trade impact</dt>
            <dd>{result.metrics.maximumPriceImpactPct}%</dd>
            <dt>Maximum drawdown</dt>
            <dd>{result.metrics.maximumDrawdownPct}%</dd>
            <dt>Base-denominated fees</dt>
            <dd>
              {result.metrics.baseFees} {baseSymbol}
            </dd>
            <dt>Quote-denominated fees</dt>
            <dd>
              {result.metrics.quoteFees} {quoteSymbol}
            </dd>
          </dl>
          <div className="table-scroll">
            <table>
              <caption>Executed trades · modeled</caption>
              <thead>
                <tr>
                  <th scope="col">Trade</th>
                  <th scope="col">Consumed input</th>
                  <th scope="col">Received</th>
                  <th scope="col">Trading fee</th>
                  <th scope="col">Price impact</th>
                  <th scope="col">Fill</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((trade, index) => (
                  <tr key={`${result.id}-${index}`}>
                    <th scope="row">
                      {index + 1}. {trade.direction}
                    </th>
                    <td>
                      {trade.consumedInput} {trade.direction === "buy" ? quoteSymbol : baseSymbol}
                    </td>
                    <td>
                      {trade.output} {trade.direction === "buy" ? baseSymbol : quoteSymbol}
                    </td>
                    <td>
                      {trade.fee} {trade.feeAsset === "base" ? baseSymbol : quoteSymbol}
                    </td>
                    <td>{trade.priceImpactPct}%</td>
                    <td>
                      {trade.status}
                      {trade.status === "partial" && (
                        <small>
                          {" "}
                          · unfilled {trade.unfilledInput}{" "}
                          {trade.direction === "buy" ? quoteSymbol : baseSymbol}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Lifecycle: {result.lifecycle}. Curve completion is not DAMM migration. No destination
            settlement is supplied or simulated here. Fees are separate by asset; the trading-fee
            field is not added again to its recipient splits.
          </p>
          <details>
            <summary>Replay inputs & exact results</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
          <p className="muted">
            Engine {result.engineVersion} · SDK {result.sdkVersion} · deterministic (no random seed)
            · {result.verificationStatus}. Same configured clocks and inputs reproduce this modeled
            result.
          </p>
        </div>
      )}
    </section>
  );
}
