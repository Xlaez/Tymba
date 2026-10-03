import { useRef, useState } from "react";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };
import type { CliAttackScenario } from "../cli/attack.js";
import type { WebAttackRequest, WebAttackResponse } from "../web-api/contracts.js";
import { postJson } from "./api.js";
import { EvidenceNotice } from "./EvidenceNotice.js";

export const attackNames = {
  "opening-sniper": "Opening sniper",
  "whale-entry": "Whale entry",
  "pump-and-dump": "Pump and dump",
  "sell-cascade": "Sell cascade",
  "fee-schedule-timing": "Fee-schedule timing",
} as const;

export function Attack({
  compileRequest,
  candidateId,
  onEvidenceChange,
}: {
  compileRequest: unknown;
  candidateId: string;
  onEvidenceChange?: (requests: readonly WebAttackRequest[]) => void;
}) {
  const [scenario, setScenario] = useState<CliAttackScenario>("opening-sniper");
  const [configuration, setConfiguration] = useState(
    JSON.stringify(fixture.attacks["opening-sniper"], null, 2),
  );
  const [warmup, setWarmup] = useState("");
  const [records, setRecords] = useState<
    Partial<Record<CliAttackScenario, { request: WebAttackRequest; result: WebAttackResponse }>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  function invalidate() {
    revision.current++;
    setBusy(false);
    setError("");
    setRecords({});
    onEvidenceChange?.([]);
  }
  async function run() {
    const current = ++revision.current;
    setBusy(true);
    setError("");
    const next = { ...records };
    delete next[scenario];
    setRecords(next);
    onEvidenceChange?.(
      Object.values(next)
        .filter((entry) => entry.result.snapshot !== undefined)
        .map((entry) => entry.request),
    );
    try {
      const request: WebAttackRequest = {
        compileRequest,
        candidateId,
        scenario,
        configuration: JSON.parse(configuration),
        ...(warmup ? { warmupQuoteAtomic: warmup } : {}),
      };
      const result = await postJson<WebAttackResponse>("/api/attack", request);
      if (current === revision.current) {
        const updated = { ...next, [scenario]: { request, result } };
        setRecords(updated);
        onEvidenceChange?.(
          Object.values(updated)
            .filter((entry) => entry.result.snapshot !== undefined)
            .map((entry) => entry.request),
        );
      }
    } catch (failure) {
      if (current === revision.current)
        setError(failure instanceof Error ? failure.message : "Attack failed.");
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="attack-title" aria-busy={busy}>
      <div className="section-heading">
        <span className="step">04</span>
        <div>
          <h2 id="attack-title">Attack My Market</h2>
          <p>Five explicit adversarial models. No safety predictions.</p>
        </div>
      </div>
      <EvidenceNotice stage="attack" />
      <p className="muted">
        These editable reference scenarios use atomic units, explicit populations, seeds, and
        clocks. Inspect and adapt them for your assets. Metrics aggregate completed iterations only;
        partial and failed outcomes remain in the exact evidence. Local runs are limited to 2,000
        agent-ticks.
      </p>
      <label className="field">
        <span>Attack scenario</span>
        <select
          aria-label="Attack scenario"
          value={scenario}
          onChange={(event) => {
            revision.current++;
            setBusy(false);
            setError("");
            const value = event.target.value as CliAttackScenario;
            setScenario(value);
            setConfiguration(
              JSON.stringify(
                records[value]?.request.configuration ?? fixture.attacks[value],
                null,
                2,
              ),
            );
            setWarmup(records[value]?.request.warmupQuoteAtomic ?? "");
          }}
        >
          {Object.entries(attackNames).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Optional warm-up (quote atomic units; blank = none)</span>
        <input
          aria-label="Attack warm-up quote atomic"
          value={warmup}
          onChange={(event) => {
            invalidate();
            setWarmup(event.target.value);
          }}
          maxLength={20}
        />
      </label>
      <details open>
        <summary>Explicit attack assumptions</summary>
        <label className="field">
          <span>Scenario configuration JSON · integer economics are strings</span>
          <textarea
            aria-label="Attack configuration JSON"
            value={configuration}
            onChange={(event) => {
              invalidate();
              setConfiguration(event.target.value);
            }}
            rows={16}
            maxLength={24000}
          />
        </label>
      </details>
      <button type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Running attack…" : "Run selected attack"}
      </button>
      {busy && (
        <output aria-live="polite" className="workflow-state">
          Running the selected model on this draft. Changes discard its pending response.
        </output>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {Object.entries(records).map(([key, { result }]) => (
        <article key={key} data-testid={`attack-result-${key}`} className="attack-result">
          <h3>
            {attackNames[key as CliAttackScenario]} · {result.status}
          </h3>
          <output
            className={`result-status ${result.status === "completed" ? "satisfied" : "partial"}`}
          >
            {result.status === "partial"
              ? "Partial attack · completed iterations only contribute metrics"
              : result.status === "failed"
                ? "Attack failed · no completed metrics"
                : result.status === "unsupported"
                  ? "Unsupported model for this configuration"
                  : result.status}
          </output>
          <p>{result.message}</p>
          {result.summary && (
            <>
              <p>
                Seed: {result.summary.seed ?? "none — deterministic boundary sweep"}.{" "}
                {result.summary.completed} completed / {result.summary.requested} requested{" "}
                {result.summary.countUnit}; {result.summary.partial} partial,{" "}
                {result.summary.failed} failed.
              </p>
              <p className="fine-print">
                Engine {result.summary.engineVersion} · SDK {result.summary.sdkVersion} · modeled ·
                unverified
              </p>
            </>
          )}
          {result.measurements && result.measurements.length > 0 && (
            <dl className="metrics">
              {result.measurements.map((metric) => (
                <div className="metric-pair" key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>
                    {metric.value} <small>{metric.unit}</small>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {result.metrics && (
            <details open>
              <summary>Completed modeled metrics (raw exact units)</summary>
              <pre>{JSON.stringify(result.metrics, null, 2)}</pre>
            </details>
          )}
          {result.snapshot && (
            <details>
              <summary>Exact attack evidence, seeds, iteration outcomes and units</summary>
              <pre>{JSON.stringify(result.snapshot, null, 2)}</pre>
            </details>
          )}
        </article>
      ))}
      {Object.keys(records).length === 0 && !busy && (
        <p className="muted">
          No attacks retained for this draft yet. Choose a model and review its assumptions.
        </p>
      )}
    </section>
  );
}
