import { useRef, useState } from "react";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };
import type {
  WebAuditRequest,
  WebAuditResponse,
  WebHardeningResponse,
} from "../web-api/contracts.js";
import { Advanced } from "./Advanced.js";
import { postJson } from "./api.js";
import { EvidenceNotice } from "./EvidenceNotice.js";
import { comparisonAssessment } from "./evidence.js";

const opening = fixture.attacks["opening-sniper"];
const replay = {
  id: "web-reference-stochastic",
  randomSeed: opening.randomSeed,
  requestedIterations: opening.requestedIterations,
  agentDistribution: opening.supportingAgentDistribution,
  ticks: { ...opening.ticks, executionOrder: "configured" },
};

export function Harden({
  audit,
  auditRequest,
}: {
  audit: Exclude<WebAuditResponse, { status: "failed" }>;
  auditRequest: WebAuditRequest;
}) {
  const findings = audit.categories.flatMap((category) => category.findings);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [impactWeight, setImpactWeight] = useState("0");
  const [attackWeight, setAttackWeight] = useState("0.3");
  const [stochastic, setStochastic] = useState(JSON.stringify(replay, null, 2));
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<WebHardeningResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  function invalidate() {
    revision.current++;
    setResult(null);
    setBusy(false);
    setError("");
    setConfirmed(false);
  }
  async function run() {
    const current = ++revision.current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await postJson<WebHardeningResponse>("/api/harden", {
        auditRequest,
        findingIds: selected,
        riskWeights: { earlyPriceImpact: impactWeight, attackProfitability: attackWeight },
        stochasticReplay: JSON.parse(stochastic),
      });
      if (current === revision.current) setResult(response);
    } catch (failure) {
      if (current === revision.current)
        setError(failure instanceof Error ? failure.message : "Hardening failed.");
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  return (
    <section aria-labelledby="harden-title" aria-busy={busy} className="hardening">
      <h3 id="harden-title">Compare a revised design</h3>
      <p>
        Optimize supported numeric risk metrics, not severity labels. Targets, asset metadata, fees,
        clocks and original evidence remain unchanged. A new draft may be unchanged, worse on other
        metrics, or impossible.
      </p>
      <fieldset>
        <legend>Choose findings to address</legend>
        {findings.map((finding) => (
          <label key={finding.id} className="confirmation">
            <input
              type="checkbox"
              checked={selected.includes(finding.id)}
              onChange={(event) => {
                invalidate();
                setSelected(
                  event.target.checked
                    ? [...selected, finding.id]
                    : selected.filter((id) => id !== finding.id),
                );
              }}
            />
            {finding.title} · {finding.rawValueBps} bps · {finding.id}
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Supported mappings: opening-sniper return, and an early-impact first buy matching an
        explicit compile probe. Other findings produce explicit unsupported reasons. All mappings
        use recomputed raw evidence.
      </p>
      <div className="field-grid">
        {(
          [
            ["Early-impact risk weight", impactWeight, setImpactWeight],
            ["Attack-profitability risk weight", attackWeight, setAttackWeight],
          ] as const
        ).map(([label, value, setter]) => (
          <label className="field" key={label}>
            <span>{label}</span>
            <input
              aria-label={label}
              value={value}
              maxLength={64}
              onChange={(event) => {
                invalidate();
                setter(event.target.value);
              }}
            />
          </label>
        ))}
      </div>
      <details open>
        <summary>Paired replay assumptions</summary>
        <p>
          Replay the retained script and attack inputs unchanged on both drafts. The separate
          stochastic population below is an editable reference, not inferred demand. Its seed,
          iterations, tick clocks and order are explicit. Attack warm-ups are currently unsupported
          in paired replay.
        </p>
        <label className="field">
          <span>Stochastic replay JSON</span>
          <textarea
            aria-label="Stochastic replay JSON"
            rows={14}
            maxLength={16000}
            value={stochastic}
            onChange={(event) => {
              invalidate();
              setStochastic(event.target.value);
            }}
          />
        </label>
      </details>
      <label className="confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I reviewed the numeric weights and paired replay assumptions.
      </label>
      {!auditRequest.trades && (
        <p className="muted">Run a deterministic script before hardening.</p>
      )}
      {auditRequest.attacks.length === 0 && (
        <p className="muted">Run at least one attack before hardening.</p>
      )}
      <button
        type="button"
        disabled={
          busy ||
          !confirmed ||
          selected.length === 0 ||
          !auditRequest.trades ||
          auditRequest.attacks.length === 0
        }
        onClick={() => void run()}
      >
        {busy ? "Generating & replaying…" : "Harden selected findings"}
      </button>
      {busy && (
        <output aria-live="polite" className="workflow-state">
          Searching numeric objectives, then replaying identical inputs on both drafts…
        </output>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <div data-testid="hardening-result">
          <output
            className={`result-status ${result.status === "completed" ? "satisfied" : "partial"}`}
          >
            Hardening {result.status}
          </output>
          <EvidenceNotice stage="hardening" />
          <p>{result.message}</p>
          {result.originalCandidateId && (
            <p>
              Before {result.originalCandidateId} → after {result.hardenedCandidateId}. Baseline
              remains selected above.
            </p>
          )}
          <ul>
            {result.notices.map((notice, index) => (
              <li key={`${index}-${notice}`}>{notice}</li>
            ))}
          </ul>
          {result.metrics.length > 0 && (
            <div className="table-scroll">
              <table>
                <caption>Before / after · exact modeled units</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric / unit</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Delta</th>
                    <th scope="col">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {result.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <th scope="row">
                        {metric.label}
                        <small>
                          {" "}
                          · {metric.unit} · {metric.direction}
                        </small>
                      </th>
                      <td>{metric.baseline ?? "unavailable"}</td>
                      <td>{metric.hardened ?? "unavailable"}</td>
                      <td>{metric.delta ?? "unavailable"}</td>
                      <td>
                        {metric.status} · {comparisonAssessment(metric)}
                        {metric.reason && <small> · {metric.reason}</small>}
                        <details>
                          <summary>Source references</summary>
                          {metric.references.join(" · ")}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.advanced && <Advanced parameters={result.advanced} />}
          {result.snapshot && (
            <details>
              <summary>Exact generation, paired outcomes, seeds and original evidence</summary>
              <pre>{JSON.stringify(result.snapshot, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
