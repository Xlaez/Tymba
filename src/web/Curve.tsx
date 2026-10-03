import { Decimal } from "decimal.js";
import { useState } from "react";
import type { WebDraftCandidate } from "../web-api/contracts.js";
import { Advanced } from "./Advanced.js";
import { EvidenceNotice } from "./EvidenceNotice.js";

const PlotDecimal = Decimal.clone({ precision: 512 });
const colors = ["#366d55", "#7c9e5e", "#c0b46d"];

export function Curve({
  candidate,
  baseSymbol,
  quoteSymbol,
}: {
  candidate: WebDraftCandidate;
  baseSymbol: string;
  quoteSymbol: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const firstSegment = candidate.segments[0];
  const lastSegment = candidate.segments.at(-1);
  const selected = candidate.segments[selectedIndex];
  if (!firstSegment || !lastSegment || !selected) return null;
  const lowerPrice = new PlotDecimal(firstSegment.lowerPrice);
  const priceSpan = new PlotDecimal(lastSegment.upperPrice).minus(lowerPrice);
  const lastQuote = lastSegment.points.at(-1)?.quote;
  if (!lastQuote || priceSpan.lte(0) || new PlotDecimal(lastQuote).lte(0)) return null;
  const paths = candidate.segments.map((segment) =>
    segment.points
      .map((point, index) => {
        const x = new PlotDecimal(point.quote).div(lastQuote).mul(590).plus(65).toFixed(3);
        const y = new PlotDecimal(255)
          .minus(new PlotDecimal(point.price).minus(lowerPrice).div(priceSpan).mul(205))
          .toFixed(3);
        return `${index === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" "),
  );
  return (
    <section className="panel" aria-labelledby="curve-title">
      <div className="section-heading">
        <span className="step">↗</span>
        <div>
          <h2 id="curve-title">The path to graduation</h2>
          <p>Selected draft {candidate.rank} · quantized curve economics</p>
        </div>
      </div>
      <EvidenceNotice stage="curve" />
      <div className="chart">
        <svg
          viewBox="0 0 720 325"
          role="img"
          aria-labelledby="curve-chart-title curve-chart-description"
        >
          <title id="curve-chart-title">Spot price against cumulative net capital</title>
          <desc id="curve-chart-description">
            {candidate.segmentCount} increasing-price segments. The chart plots {quoteSymbol} units
            in the curve against {quoteSymbol} per {baseSymbol}. Select a segment using the buttons
            below for exact amounts.
          </desc>
          {[50, 118, 187, 255].map((y) => (
            <line key={y} x1="65" y1={y} x2="655" y2={y} stroke="#e5eadf" strokeDasharray="3 5" />
          ))}
          <text x="65" y="25" className="chart-label">
            Price · {quoteSymbol}/{baseSymbol}
          </text>
          <text x="65" y="280" className="chart-label">
            0
          </text>
          <text x="655" y="280" textAnchor="end" className="chart-label">
            {new PlotDecimal(lastQuote).toSignificantDigits(7).toFixed()}
          </text>
          <text x="360" y="311" textAnchor="middle" className="chart-label">
            Net capital in the curve · {quoteSymbol}
          </text>
          <text x="55" y="255" textAnchor="end" className="chart-label">
            {lowerPrice.toSignificantDigits(4).toString()}
          </text>
          <text x="55" y="53" textAnchor="end" className="chart-label">
            {new PlotDecimal(lastSegment.upperPrice).toSignificantDigits(4).toString()}
          </text>
          {paths.map((path, index) => (
            <path
              key={candidate.segments[index]?.index}
              d={path}
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth={selectedIndex === index ? 5 : 3}
              opacity={selectedIndex === index ? 1 : 0.6}
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>
      <fieldset className="segment-tabs">
        <legend>Select a curve segment</legend>
        {candidate.segments.map((segment) => (
          <button
            type="button"
            key={segment.index}
            aria-pressed={selectedIndex === segment.index}
            className={selectedIndex === segment.index ? "selected" : "secondary"}
            onClick={() => setSelectedIndex(segment.index)}
          >
            Segment {segment.index + 1}
          </button>
        ))}
      </fieldset>
      <div className="segment-detail" data-testid="segment-detail">
        <span className="eyebrow">
          SEGMENT {selected.index + 1} ·{" "}
          {selected.index === 0
            ? "OPENING BAND"
            : selected.index === candidate.segmentCount - 1
              ? "GRADUATION BAND"
              : "MIDDLE BAND"}
        </span>
        <dl className="metrics">
          <dt>Price range</dt>
          <dd>
            {new PlotDecimal(selected.lowerPrice).toSignificantDigits(8).toString()} →{" "}
            {new PlotDecimal(selected.upperPrice).toSignificantDigits(8).toString()} {quoteSymbol}/
            {baseSymbol}
          </dd>
          <dt>Capital absorbed</dt>
          <dd>
            {selected.quoteAbsorbed} {quoteSymbol}
          </dd>
          <dt>Tokens distributed</dt>
          <dd>
            {selected.baseDistributed} {baseSymbol}
          </dd>
          <dt>Share of curve capital</dt>
          <dd>{selected.quoteContributionPct}%</dd>
          <dt>Share of curve distribution</dt>
          <dd>{selected.distributionContributionPct}%</dd>
        </dl>
        <p>{selected.explanation}</p>
      </div>
      <p className="muted">
        Local segment calculations from the encoded curve, not expected demand. Capital is net of
        trading fees. The sampled graph is presentation-only; exact segment amounts drive the
        explanation.
      </p>
      {candidate.advanced && <Advanced parameters={candidate.advanced} />}
    </section>
  );
}
