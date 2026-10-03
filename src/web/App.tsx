import { useRef, useState } from "react";
import type { ReviewResponse, WebCompileResponse } from "../web-api/contracts.js";
import { postJson } from "./api.js";
import { Compile } from "./Compile.js";
import { Curve } from "./Curve.js";
import { Describe } from "./Describe.js";
import {
  type DescribeFields,
  demoConfiguration,
  describeIntent,
  initialDescribeFields,
} from "./describe-model.js";
import { EvidenceNotice } from "./EvidenceNotice.js";
import { Review } from "./Review.js";
import { RiskWorkflow } from "./RiskWorkflow.js";

export function App() {
  const [fields, setFields] = useState<DescribeFields>(initialDescribeFields);
  const [designNote, setDesignNote] = useState("");
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const [configuration, setConfiguration] = useState(JSON.stringify(demoConfiguration, null, 2));
  const [confirmed, setConfirmed] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [compiled, setCompiled] = useState<WebCompileResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [compiledRequest, setCompiledRequest] = useState<unknown>(null);
  const selectedCandidate = compiled?.candidates.find((candidate) => candidate.id === selectedId);

  function invalidate() {
    revision.current += 1;
    setReview(null);
    setError("");
    setReviewing(false);
    setConfirmed(false);
    setCompiled(null);
    setCompiling(false);
    setCompileError("");
    setSelectedId("");
    setCompiledRequest(null);
  }

  async function compileIntent() {
    if (review?.status !== "valid" || !confirmed) return;
    const currentRevision = ++revision.current;
    setCompiling(true);
    setCompileError("");
    setCompiled(null);
    try {
      const settings: unknown = JSON.parse(configuration);
      if (typeof settings !== "object" || settings === null || Array.isArray(settings))
        throw new Error("Configuration must be a JSON object.");
      if (Object.hasOwn(settings, "marketIntent"))
        throw new Error("Configuration must not override the reviewed marketIntent.");
      const request = {
        ...settings,
        marketIntent: review.intent,
      };
      const result = await postJson<WebCompileResponse>("/api/compile", request);
      if (currentRevision === revision.current) {
        setCompiled(result);
        setCompiledRequest(request);
        setSelectedId(result.candidates[0]?.id ?? "");
      }
    } catch (failure) {
      if (currentRevision === revision.current)
        setCompileError(failure instanceof Error ? failure.message : "Compile failed.");
    } finally {
      if (currentRevision === revision.current) setCompiling(false);
    }
  }

  async function reviewIntent() {
    const currentRevision = ++revision.current;
    setReviewing(true);
    setError("");
    setReview(null);
    try {
      const result = await postJson<ReviewResponse>("/api/review", {
        marketIntent: describeIntent(fields),
        designNote,
      });
      if (currentRevision === revision.current) setReview(result);
    } catch (failure) {
      if (currentRevision === revision.current)
        setError(failure instanceof Error ? failure.message : "Validation failed.");
    } finally {
      if (currentRevision === revision.current) setReviewing(false);
    }
  }
  return (
    <div className="studio">
      <aside className="rail">
        <a className="wordmark" href="#top">
          tymba<span>↗</span>
        </a>
        <span className="rail-label">MARKET STUDIO</span>
        <nav aria-label="Workflow">
          <a href="#describe-title" aria-current="step">
            <span>01</span> Describe
          </a>
          <a href="#compile-title">
            <span>02</span> Drafts
          </a>
          <a href="#simulate-title">
            <span>03</span> Replay
          </a>
          <a href="#attack-title">
            <span>04</span> Stress test
          </a>
          <a href="#audit-title">
            <span>05</span> Evidence
          </a>
        </nav>
        <div className="rail-bottom">
          <span className="live-dot" /> Local design workspace<p>Design. Attack. Compare.</p>
        </div>
      </aside>
      <main id="top">
        <header className="topbar">
          <span>Workspace / New market</span>
          <span className="badge">MODELED · NOT DEPLOYABLE</span>
        </header>
        <div className="workspace">
          <div className="hero">
            <span className="eyebrow">ECONOMIC INTENT → MARKET DESIGN</span>
            <h1>
              What should your
              <br />
              market do?
            </h1>
            <p>
              Design the economics before the first trade.
              <br />
              Compile measurable goals into explainable curve drafts.
            </p>
          </div>
          <EvidenceNotice stage="workspace" />
          <section className="workflow-guide-panel" aria-labelledby="workflow-guide-title">
            <h2 id="workflow-guide-title">How the studio works</h2>
            <ol className="workflow-guide">
              <li>
                <span className="workflow-guide-number">01</span>
                <span>
                  <strong>Set goals</strong>
                  <small>Supply, opening value, graduation and capital</small>
                </span>
              </li>
              <li>
                <span className="workflow-guide-number">02</span>
                <span>
                  <strong>Check the values</strong>
                  <small>Confirm the numbers match your plan</small>
                </span>
              </li>
              <li>
                <span className="workflow-guide-number">03</span>
                <span>
                  <strong>Compare designs</strong>
                  <small>Choose a price path that fits your goals</small>
                </span>
              </li>
              <li>
                <span className="workflow-guide-number">04</span>
                <span>
                  <strong>Replay trades</strong>
                  <small>See the result of the same trade plan</small>
                </span>
              </li>
              <li>
                <span className="workflow-guide-number">05</span>
                <span>
                  <strong>Try modeled pressure</strong>
                  <small>Test large buys and waves of selling</small>
                </span>
              </li>
              <li>
                <span className="workflow-guide-number">06</span>
                <span>
                  <strong>Review and improve</strong>
                  <small>Read the evidence and compare changes</small>
                </span>
              </li>
            </ol>
          </section>
          <div className="workspace-grid">
            <div className="flow">
              <Describe
                fields={fields}
                designNote={designNote}
                onDesignNoteChange={(value) => {
                  invalidate();
                  setDesignNote(value);
                }}
                onChange={(key, value) => {
                  invalidate();
                  setFields((current) => ({ ...current, [key]: value }));
                }}
              />
              <Review
                review={review}
                busy={reviewing}
                error={error}
                onReview={() => void reviewIntent()}
              />
              <Compile
                configuration={configuration}
                onConfigurationChange={(value) => {
                  invalidate();
                  setConfiguration(value);
                }}
                reviewed={review?.status === "valid"}
                confirmed={confirmed}
                onConfirm={setConfirmed}
                busy={compiling || reviewing}
                error={compileError}
                result={compiled}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCompile={() => void compileIntent()}
                baseSymbol={
                  review?.status === "valid" ? review.intent.assets.base.symbol : fields.baseSymbol
                }
                quoteSymbol={
                  review?.status === "valid"
                    ? review.intent.assets.quote.symbol
                    : fields.quoteSymbol
                }
              />
              {compiled?.candidates
                .filter((candidate) => candidate.id === selectedId)
                .map((candidate) => (
                  <Curve
                    key={candidate.id}
                    candidate={candidate}
                    baseSymbol={fields.baseSymbol}
                    quoteSymbol={fields.quoteSymbol}
                  />
                ))}
              {selectedCandidate && compiled && selectedId && compiledRequest !== null && (
                <RiskWorkflow
                  key={selectedId}
                  compileRequest={compiledRequest}
                  compilation={compiled}
                  candidate={selectedCandidate}
                  candidateId={selectedId}
                  baseSymbol={fields.baseSymbol}
                  quoteSymbol={fields.quoteSymbol}
                />
              )}
              {!selectedId && (
                <section className="panel" aria-label="Workflow prerequisites">
                  <h2>Simulation, attacks & audit</h2>
                  <p className="muted">
                    Validate and review your intent, compile it, and select a curve draft to unlock
                    these steps. No modeled results exist yet.
                  </p>
                  {compiled && compiled.candidates.length === 0 && (
                    <output aria-live="polite">
                      No feasible draft was emitted. Resolve the compile issues above before
                      continuing.
                    </output>
                  )}
                </section>
              )}
            </div>
            <aside className="context-panel">
              <span className="eyebrow">START WITH A REFERENCE</span>
              <h3>The balanced demo</h3>
              <p>A billion tokens. A measured path from opening price to graduation.</p>
              <dl>
                <dt>Quote asset</dt>
                <dd>USDC · 6 decimals</dd>
                <dt>Launch profile</dt>
                <dd>Balanced</dd>
                <dt>Curve segments</dt>
                <dd>Up to 3</dd>
              </dl>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  invalidate();
                  setFields(initialDescribeFields);
                }}
              >
                Load demo intent
              </button>
              <p className="fine-print">
                All prices are quote-denominated. Asset symbols are labels, not evidence of a live
                mint or a USD peg.
              </p>
            </aside>
          </div>
        </div>
        <footer>
          Deterministic mathematics. Modeled outcomes. No fundraising or safety guarantees.
        </footer>
      </main>
    </div>
  );
}
