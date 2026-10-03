import type { DescribeFields } from "./describe-model.js";

type Props = {
  fields: DescribeFields;
  onChange: (key: keyof DescribeFields, value: string) => void;
  designNote: string;
  onDesignNoteChange: (value: string) => void;
};

export function Describe({ fields, onChange, designNote, onDesignNoteChange }: Props) {
  function field(key: keyof DescribeFields, label: string, hint?: string) {
    return (
      <label className="field" key={key}>
        <span>{label}</span>
        <input
          type="text"
          aria-label={label}
          inputMode={key.includes("Symbol") || key.includes("Mint") ? "text" : "decimal"}
          value={fields[key]}
          onChange={(event) => onChange(key, event.target.value)}
          maxLength={256}
        />
        {hint && <small>{hint}</small>}
      </label>
    );
  }

  function select(key: keyof DescribeFields, label: string, choices: readonly string[]) {
    return (
      <label className="field">
        <span>{label}</span>
        <select value={fields[key]} onChange={(event) => onChange(key, event.target.value)}>
          <option value="">Not specified</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <section className="panel" aria-labelledby="describe-title">
      <div className="section-heading">
        <span className="step">01</span>
        <div>
          <h2 id="describe-title">Describe your market</h2>
          <p>Start with outcomes. We’ll work backwards to the curve.</p>
        </div>
      </div>
      <details>
        <summary>Add a plain-English design note (optional)</summary>
        <p className="muted" id="note-help">
          Automatic AI interpretation is not connected yet. Record your goals here, then enter their
          economic values in the fields below. Only reviewed structured values are sent to the
          solver.
        </p>
        <label className="field">
          <span>Market intent in your own words</span>
          <textarea
            aria-describedby="note-help"
            value={designNote}
            onChange={(event) => onDesignNoteChange(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="I have a billion tokens. Start near 200k FDV, graduate near 2m, and distribute about 25%…"
          />
        </label>
        <small>
          Optional · up to 4,000 characters · retained with your reviewed input, not interpreted or
          enforced
        </small>
      </details>
      <fieldset>
        <legend>Assets & supply</legend>
        <div className="fields">
          {field("baseSymbol", "Token symbol")}
          {field("quoteSymbol", "Quote asset symbol")}
          {field("totalBase", "Total token supply", "Human token units, not atomic amounts")}
          {field("baseDecimals", "Token decimals", "6–9")}
          {field("quoteDecimals", "Quote decimals", "0–255; USDC uses 6")}
        </div>
      </fieldset>
      <fieldset>
        <legend>Opening & graduation</legend>
        <div className="fields">
          {field("startFdv", "Starting FDV", `In ${fields.quoteSymbol || "quote"} units`)}
          {field("migrationFdv", "Graduation FDV", `In ${fields.quoteSymbol || "quote"} units`)}
          {field(
            "quoteToMigration",
            "Capital before graduation",
            `Net ${fields.quoteSymbol || "quote"} in the curve, excluding trading fees`,
          )}
          {field(
            "baseDistributionPct",
            "Supply distributed before graduation (%)",
            "25 means 25% of the total supply",
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>Design preferences</legend>
        <div className="fields">
          {select("launchProfile", "Launch profile", ["deep", "balanced", "momentum"])}
          {select("sniperResistance", "Opening sniper resistance goal", ["low", "medium", "high"])}
          {field("maxSegments", "Maximum curve segments", "1–16; initial search uses up to 3")}
        </div>
        <p className="muted">
          Preferences describe intent, not promised protection. Unsupported objectives will be
          identified by the solver.
        </p>
      </fieldset>
      <details>
        <summary>Additional intent fields</summary>
        <div className="fields">
          {field(
            "startPrice",
            "Starting price",
            "Quote units per token; must agree with FDV if both are set",
          )}
          {field(
            "migrationPrice",
            "Graduation price",
            "Quote units per token; must agree with FDV if both are set",
          )}
          {field("maxEarlyPriceImpactPct", "Maximum early price impact (%)")}
          {field("earlyBuyerAdvantagePct", "Early buyer advantage goal (%)")}
          {field("baseMint", "Token mint (optional)")}
          {field("quoteMint", "Quote mint (optional)")}
        </div>
      </details>
      <details>
        <summary>Post-graduation allocation intent</summary>
        <p className="muted">
          These are design goals. Mapping this three-part intent to the protocol’s six allocation
          buckets is unresolved; no automatic mapping is applied.
        </p>
        <div className="fields">
          {field("creatorLockedPct", "Creator locked (%)")}
          {field("partnerLockedPct", "Partner locked (%)")}
          {field("unlockedPct", "Unlocked (%)")}
          {field("lockDurationSeconds", "Lock duration (seconds)")}
        </div>
      </details>
    </section>
  );
}
