import type { ReviewResponse } from "../web-api/contracts.js";
import { EvidenceNotice } from "./EvidenceNotice.js";

type Props = { review: ReviewResponse | null; busy: boolean; error: string; onReview: () => void };

export function Review({ review, busy, error, onReview }: Props) {
  return (
    <section className="panel" aria-labelledby="review-title" aria-busy={busy}>
      <div className="section-heading">
        <span className="step">↳</span>
        <div>
          <h2 id="review-title">Review the structured intent</h2>
          <p>Check the resolved economics before solving.</p>
        </div>
      </div>
      <button type="button" onClick={onReview} disabled={busy}>
        {busy ? "Validating…" : "Validate & review"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!review && !busy && (
        <p className="muted">Not reviewed. Validate your current values to continue.</p>
      )}
      {review?.status === "invalid" && (
        <div role="alert" className="error">
          <h3>Intent needs attention</h3>
          <ul>
            {review.issues.map((issue) => (
              <li key={`${issue.path}-${issue.code}`}>
                <strong>{issue.path}</strong>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review?.status === "valid" && (
        <div className="review-result">
          <output className="success">Intent valid · ready for your review</output>
          <EvidenceNotice stage="review" />
          <dl className="metrics">
            <dt>Market</dt>
            <dd>{review.summary.market}</dd>
            <dt>Total supply</dt>
            <dd>{review.summary.totalBase}</dd>
            <dt>Starting price</dt>
            <dd>{review.summary.startPrice}</dd>
            <dt>Starting FDV</dt>
            <dd>{review.summary.startFdv}</dd>
            <dt>Graduation price</dt>
            <dd>{review.summary.migrationPrice}</dd>
            <dt>Graduation FDV</dt>
            <dd>{review.summary.migrationFdv}</dd>
            <dt>Capital target</dt>
            <dd>{review.summary.quoteToMigration ?? "Not specified"}</dd>
            <dt>Distribution target</dt>
            <dd>
              {review.summary.baseDistributionPct === undefined
                ? "Not specified"
                : `${review.summary.baseDistributionPct}%`}
            </dd>
            <dt>Maximum curve sections</dt>
            <dd>{review.summary.maxSegments}</dd>
          </dl>
          <p className="muted">
            Prices are {review.intent.assets.quote.symbol} per {review.intent.assets.base.symbol}.
            FDV and capital are in {review.intent.assets.quote.symbol}; supply is in{" "}
            {review.intent.assets.base.symbol}.
          </p>
          {review.designNote && (
            <div className="note">
              <strong>Design note · not interpreted</strong>
              <p>{review.designNote}</p>
              <small>Check that the fields reflect this note. Prose does not override them.</small>
            </div>
          )}
          <details>
            <summary>Reviewed MarketIntent JSON</summary>
            <pre>{JSON.stringify(review.intent, null, 2)}</pre>
          </details>
          <p className="muted">
            Valid intent is not proof of economic feasibility or a deployable configuration.
          </p>
        </div>
      )}
    </section>
  );
}
