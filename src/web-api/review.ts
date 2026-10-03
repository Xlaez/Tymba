import { validateDocuments } from "../cli/validate.js";
import { validateMarketIntent } from "../domain/market-intent.js";
import type { ReviewResponse } from "./contracts.js";

export function reviewDocument(input: unknown): ReviewResponse {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !["marketIntent", "designNote"].includes(key))
  ) {
    return {
      status: "invalid",
      issues: [
        {
          path: "$",
          code: "invalid_review_request",
          message: "Provide marketIntent and an optional designNote.",
        },
      ],
    };
  }
  const designNote = input.designNote ?? "";
  if (typeof designNote !== "string" || designNote.length > 4000) {
    return {
      status: "invalid",
      issues: [
        {
          path: "$.designNote",
          code: "invalid_design_note",
          message: "Design note must be text of up to 4,000 characters.",
        },
      ],
    };
  }
  const result = validateMarketIntent(input.marketIntent);
  if (result.status === "invalid") return result;
  const summary = validateDocuments(result.intent).summary;
  if (!summary) throw new Error("Validated intent has no summary");
  return { status: "valid", intent: result.intent, summary, designNote };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
