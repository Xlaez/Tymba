import { useRef, useState } from "react";
import { DEMO_AUDIT_SEVERITY_POLICY } from "../domain/audit-policy.js";
import type { WebAuditRequest, WebAuditResponse } from "../web-api/contracts.js";
import { postJson } from "./api.js";
import { EvidenceNotice } from "./EvidenceNotice.js";
import { Harden } from "./Harden.js";

export function Audit({ request }: { request: WebAuditRequest }) {
  const [policy, setPolicy] = useState(
    JSON.stringify(
      DEMO_AUDIT_SEVERITY_POLICY,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
  const [result, setResult] = useState<WebAuditResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retainedRequest, setRetainedRequest] = useState<WebAuditRequest | null>(null);
  const revision = useRef(0);
  async function run() {
    const current = ++revision.current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const snapshotRequest = {
        ...request,
        policy: JSON.parse(policy),
      };
      const response = await postJson<WebAuditResponse>("/api/audit", snapshotRequest);
      if (current === revision.current) {
        setResult(response);
        setRetainedRequest(snapshotRequest);
      }
    } catch (failure) {
      if (current === revision.current)
        setError(failure instanceof Error ? failure.message : "Audit failed.");
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="audit-title" aria-busy={busy}>
      <div className="section-heading">
        <span className="step">05</span>
        <div>
          <h2 id="audit-title">Audit the evidence</h2>
          <p>Raw observations first. Heuristic severity, not a safety score.</p>
        </div>
      </div>
      <EvidenceNotice stage="audit" />
      <p className="muted">
        Uses the selected draft’s curve-completion replay,{" "}
        {request.trades ? "your retained deterministic script" : "no retained custom script"}, and{" "}
        {request.attacks.length} retained attack configurations. Sources are recomputed from exact
        inputs, not trusted client metrics. Missing categories are unavailable, not LOW risk. Sniper
        return uses the configured attacker’s initial quote balance as its explicit capital basis,
        not just the entry buy size.
      </p>
      <details>
        <summary>Editable severity policy · provisional demo-v1</summary>
        <p>
          Thresholds are illustrative demo heuristics, not industry standards or protocol
          guarantees. Change the version when changing the policy. Thresholds use basis points; 100
          bps = 1%.
        </p>
        <label className="field">
          <span>Complete policy JSON</span>
          <textarea
            aria-label="Severity policy JSON"
            rows={14}
            maxLength={12000}
            value={policy}
            onChange={(event) => {
              revision.current++;
              setBusy(false);
              setResult(null);
              setError("");
              setPolicy(event.target.value);
            }}
          />
        </label>
      </details>
      <button type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Analyzing evidence…" : "Run economic audit"}
      </button>
      {busy && (
        <output aria-live="polite" className="workflow-state">
          Recomputing retained evidence and applying the versioned policy…
        </output>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result?.status === "failed" && (
        <p role="alert" className="error">
          {result.message}
        </p>
      )}
      {result && result.status !== "failed" && (
        <div data-testid="audit-result">
          <output className="result-status partial">
            Audit {result.status} · modeled · unverified
          </output>
          {result.categories.map((category) => (
            <article key={category.category} className="audit-category">
              <h3>
                {category.category} · {category.status}
              </h3>
              {category.reason && <p className="muted">{category.reason}</p>}
              {category.findings.map((finding) => (
                <div key={finding.id} className="audit-finding">
                  <h4>{finding.title}</h4>
                  <p>
                    <strong>{finding.rawValueBps} bps</strong> · {finding.metric} →{" "}
                    <span className={`severity severity-${finding.severity.toLowerCase()}`}>
                      {finding.severity}
                    </span>
                  </p>
                  <p className="fine-print">
                    Policy {finding.policyVersion} · MODERATE / HIGH at {finding.thresholds}
                  </p>
                  <p>{finding.summary}</p>
                  <details>
                    <summary>Supporting evidence and references</summary>
                    <ul>
                      {finding.evidence.map((evidence, index) => (
                        <li key={`${finding.id}-evidence-${index}`}>{evidence}</li>
                      ))}
                    </ul>
                  </details>
                  <ul>
                    {finding.remediations.map((remediation) => (
                      <li key={remediation}>{remediation}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          ))}
          <details>
            <summary>Exact audit snapshot, policy and retained source runs</summary>
            <pre>{JSON.stringify(result.snapshot, null, 2)}</pre>
          </details>
        </div>
      )}
      {!result && !busy && !error && (
        <p className="muted">
          No audit yet. Run attacks or a custom script to expand the available evidence, then
          analyze.
        </p>
      )}
      {result && result.status !== "failed" && retainedRequest && (
        <Harden audit={result} auditRequest={retainedRequest} />
      )}
    </section>
  );
}
