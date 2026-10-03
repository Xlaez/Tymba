import type { WebHardeningResponse } from "../web-api/contracts.js";

export const evidenceNotices = {
  workspace: {
    title: "Local models, not live markets",
    text: "These results do not guarantee fundraising, future prices, or manipulation resistance. No wallet signing, deployment, or on-chain verification is available in this workspace.",
  },
  review: {
    title: "Valid input, not a promised outcome",
    text: "Validation checks the structured intent and resolves equivalent values. It does not prove economic feasibility, future demand, or a deployable configuration. The design note is not interpreted or enforced.",
  },
  compile: {
    title: "Curve targets, not fundraising promises",
    text: "Satisfiable means the encoded curve can match the measured core targets under these settings. It does not mean buyers will arrive or capital will be raised. Unmeasured preferences are not enforced; SDK curve acceptance is not full configuration/supply validation or on-chain verification.",
  },
  curve: {
    title: "A mathematical path, not a forecast",
    text: "This graph relates encoded spot price to net capital in the curve, not time or expected demand. It does not predict realized sale prices or guarantee graduation.",
  },
  simulation: {
    title: "Scripted evidence only",
    text: "Completion describes this exact script and its fills, not future market behavior. 100% curve progress does not prove on-chain DAMM migration or destination liquidity settlement. Impact and drawdown cover only the recorded trades.",
  },
  attack: {
    title: "Tested scenarios, not attack immunity",
    text: "Completion means a model ran, not that the market is safe. Metrics use completed samples only; sample percentiles are not future bounds or profit predictions. Partial, failed, and unsupported outcomes are not zero risk. Tracked-holder concentration excludes unmodeled wallets.",
  },
  audit: {
    title: "Heuristic severity, not a safety certificate",
    text: "LOW / MODERATE / HIGH classify individual raw metrics using a versioned, provisional demo policy, not industry standards or protocol guarantees. LOW does not mean safe; unavailable evidence is not zero risk. There is no overall safety score.",
  },
  hardening: {
    title: "Run completion is not risk reduction",
    text: "Read each numeric before/after comparison under its tested inputs and seeds. A completed run may show no improvement or worse metrics; a partial comparison covers only its available evidence. No label promises a safer launch. Both drafts remain modeled, unverified, and non-deployable.",
  },
} as const;

export function comparisonAssessment(metric: WebHardeningResponse["metrics"][number]): string {
  if (
    (metric.status !== "compared" && metric.status !== "partial") ||
    metric.baseline === null ||
    metric.hardened === null ||
    metric.delta === null ||
    metric.improved === null
  )
    return "no improvement assessment";
  const scope =
    metric.status === "partial" ? "in available partial evidence only" : "under tested inputs only";
  return `${metric.improved ? "improved" : "not improved"} ${scope}`;
}
