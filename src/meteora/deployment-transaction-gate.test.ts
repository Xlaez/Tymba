import { describe, expect, it, vi } from "vitest";
import { constructDeploymentTransactionAfterValidation } from "./deployment-transaction-gate.js";

describe("deployment transaction validation gate", () => {
  it("blocks invalid configuration before the transaction builder runs", async () => {
    const construct = vi.fn(() => ({ instructionCount: 1 }));
    const result = await constructDeploymentTransactionAfterValidation({
      input: { feeBps: -1 },
      validate: () => ({
        status: "invalid" as const,
        issues: [
          { path: "$.feeBps", code: "out_of_range", message: "Fee is outside the allowed range." },
        ],
      }),
      construct,
    });

    expect(result).toEqual({
      status: "blocked",
      stage: "configuration-validation",
      issues: [
        { path: "$.feeBps", code: "out_of_range", message: "Fee is outside the allowed range." },
      ],
    });
    expect(construct).not.toHaveBeenCalled();
  });

  it("passes the normalized validator output to the builder in order", async () => {
    const order: string[] = [];
    const input = { feeBps: "250" };
    const transaction = { instructionCount: 1 };
    const result = await constructDeploymentTransactionAfterValidation({
      input,
      validate: (value) => {
        order.push("validate");
        expect(value).toBe(input);
        return { status: "valid" as const, value: { feeBps: 250n } };
      },
      construct: async (value) => {
        order.push("construct");
        expect(value).toEqual({ feeBps: 250n });
        return transaction;
      },
    });

    expect(order).toEqual(["validate", "construct"]);
    expect(result).toEqual({ status: "prepared", transaction });
  });

  it("fails closed when validation throws without exposing the exception", async () => {
    const construct = vi.fn(() => ({ instructionCount: 1 }));
    const result = await constructDeploymentTransactionAfterValidation({
      input: { value: "test input" },
      validate: () => {
        throw new Error("test exception detail");
      },
      construct,
    });

    expect(result).toEqual({
      status: "failed",
      stage: "configuration-validation",
      code: "validator_failed",
    });
    expect(JSON.stringify(result)).not.toContain("test exception detail");
    expect(construct).not.toHaveBeenCalled();
  });

  it("returns a sanitized construction failure", async () => {
    const result = await constructDeploymentTransactionAfterValidation({
      input: { feeBps: "250" },
      validate: () => ({ status: "valid" as const, value: { feeBps: 250n } }),
      construct: () => {
        throw new Error("test builder detail");
      },
    });

    expect(result).toEqual({
      status: "failed",
      stage: "transaction-construction",
      code: "constructor_failed",
    });
    expect(JSON.stringify(result)).not.toContain("test builder detail");
  });
});
