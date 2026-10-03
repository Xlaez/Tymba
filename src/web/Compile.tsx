import { Decimal } from "decimal.js";
import type { WebCompileResponse } from "../web-api/contracts.js";
import { EvidenceNotice } from "./EvidenceNotice.js";

type Props = {
  configuration: string;
  onConfigurationChange: (value: string) => void;
  reviewed: boolean;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  busy: boolean;
  error: string;
  result: WebCompileResponse | null;
  selectedId: string;
  onSelect: (id: string) => void;
  onCompile: () => void;
  baseSymbol: string;
  quoteSymbol: string;
};

const STATUS_LABELS = {
  satisfied: "Core curve targets satisfiable",
  partial: "Core curve targets partially satisfiable",
  unsatisfied: "No feasible curve draft found",
};

export function Compile(props: Props) {
  const { result, baseSymbol, quoteSymbol } = props;
  return (
    <section className="panel" aria-labelledby="compile-title" aria-busy={props.busy}>
      <div className="section-heading">
        <span className="step">02</span>
        <div>
          <h2 id="compile-title">Compile curve drafts</h2>
          <p>Explore ranked alternatives from the deterministic solver.</p>
        </div>
      </div>
      <p className="muted">
        The initial configuration is the version-controlled demo: 25 bps fixed trading fee, quote
        collection, fixed supply, slot activation at 0; weights are 0.35 capital, 0.35 distribution,
        0.10 graduation price, 0.20 complexity, and zero for unmeasured risk terms. Current settings
        are the JSON below, including any edits. Nothing is inferred from design preferences.
      </p>
      <details>
        <summary>Solver & simulation configuration</summary>
        <p className="muted">
          Six objective weights must sum exactly to one. Economic and protocol-sized values must be
          strings. Attack/early-impact objectives need measurement providers and are unsupported in
          this compile path.
        </p>
        <label className="field">
          <span>Compile configuration JSON</span>
          <textarea
            className="json-editor"
            value={props.configuration}
            onChange={(event) => props.onConfigurationChange(event.target.value)}
            rows={16}
            maxLength={24000}
            spellCheck={false}
          />
        </label>
      </details>
      <label className="confirmation">
        <input
          type="checkbox"
          checked={props.confirmed}
          disabled={!props.reviewed || props.busy}
          onChange={(event) => props.onConfirm(event.target.checked)}
        />
        I reviewed the structured intent and explicit configuration.
      </label>
      <button
        type="button"
        disabled={!props.reviewed || !props.confirmed || props.busy}
        onClick={props.onCompile}
      >
        {props.busy ? "Solving & checking drafts…" : "Compile reviewed intent"}
      </button>
      {!props.reviewed && <p className="muted">Validate and review the current intent first.</p>}
      {props.error && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
      {result && (
        <div className="compile-result">
          <output className={`result-status ${result.solverStatus ?? "unsatisfied"}`}>
            {result.solverStatus
              ? STATUS_LABELS[result.solverStatus]
              : "Compile request needs attention"}
          </output>
          <EvidenceNotice stage="compile" />
          {result.warnings.length > 0 && (
            <div className="notice" data-testid="compile-scope">
              <strong>What this solve assessed</strong>
              <ul className="issue-list">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted">
            {result.candidateCount} feasible drafts · showing up to 3 ·{" "}
            {result.deployableCandidateCount} deployable candidates
          </p>
          <div className="notice">
            <strong>Deployment blocked · unverified</strong>
            <p>{result.failure.message}</p>
          </div>
          {result.issues.length > 0 && (
            <details open={result.candidates.length === 0}>
              <summary>Compile issues ({result.issues.length})</summary>
              <ul className="issue-list">
                {result.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="candidate-grid">
            {result.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`candidate ${props.selectedId === candidate.id ? "selected" : ""}`}
                aria-pressed={props.selectedId === candidate.id}
                aria-label={`Select draft ${candidate.rank}`}
                onClick={() => props.onSelect(candidate.id)}
              >
                <span className="candidate-heading">
                  <span>Draft {candidate.rank}</span>
                  <span>{candidate.segmentCount} segments</span>
                </span>
                <strong>
                  {candidate.quoteToMigration} <small>{quoteSymbol}</small>
                </strong>
                <span className="candidate-label">capital in curve before graduation</span>
                <span>{candidate.baseDistributionPct}% of supply distributed</span>
                <span>
                  {new Decimal(candidate.migrationFdv).toSignificantDigits(8).toFixed()}{" "}
                  {quoteSymbol} graduation FDV
                </span>
                <span className="candidate-label">
                  Objective loss{" "}
                  {new Decimal(candidate.objectiveScore).toSignificantDigits(6).toFixed()} · lower
                  is better
                </span>
                <span className="candidate-label">
                  {candidate.conflicts.length
                    ? "Has measured target differences"
                    : "Capital & distribution targets matched"}
                </span>
              </button>
            ))}
          </div>
          {result.candidates
            .filter((candidate) => candidate.id === props.selectedId)
            .map((candidate) => (
              <div key={candidate.id}>
                <p className="muted">
                  Selected draft distributes {candidate.baseDistributed} {baseSymbol}. SDK{" "}
                  {result.sdkVersion} accepted its curve array; complete configuration/supply
                  validation remains pending.
                </p>
                {candidate.conflicts.length > 0 && (
                  <div className="notice">
                    <strong>Measured target conflicts</strong>
                    {candidate.conflicts.map((conflict, index) => (
                      <div key={`${candidate.id}-${index}`}>
                        <p>{conflict.message}</p>
                        {conflict.alternatives?.map((alternative) => (
                          <p key={alternative.path}>
                            <strong>Alternative:</strong> set {alternative.path} to{" "}
                            {alternative.suggestedValue} {alternative.unit}.{" "}
                            {alternative.explanation}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          <details>
            <summary>Scope, assumptions & reproducibility</summary>
            <ul className="issue-list">
              <li>
                Draft preview ranking only: ascending exact objective loss, then candidate ID. This
                is not the ranked deployable list or a global-optimum claim.
              </li>
              <li>
                Deterministic run: no random seed. Engine {result.engineVersion}; SDK{" "}
                {result.sdkVersion}; {result.algorithmVersion}.
              </li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
