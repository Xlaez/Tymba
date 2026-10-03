import type {
  ConfigurationValidationIssue,
  ConfigurationValidationResult,
} from "../domain/configuration-validation.js";

export type DeploymentTransactionGateResult<Transaction> =
  | Readonly<{
      status: "blocked";
      stage: "configuration-validation";
      issues: readonly ConfigurationValidationIssue[];
    }>
  | Readonly<{
      status: "failed";
      stage: "configuration-validation" | "transaction-construction";
      code: "validator_failed" | "constructor_failed";
    }>
  | Readonly<{ status: "prepared"; transaction: Transaction }>;

export async function constructDeploymentTransactionAfterValidation<
  Input,
  Validated,
  Transaction,
>(options: {
  input: Input;
  validate: (input: Input) => ConfigurationValidationResult<Validated>;
  construct: (validated: Validated) => Transaction | Promise<Transaction>;
}): Promise<DeploymentTransactionGateResult<Transaction>> {
  let validation: ConfigurationValidationResult<Validated>;
  try {
    validation = options.validate(options.input);
  } catch {
    return {
      status: "failed",
      stage: "configuration-validation",
      code: "validator_failed",
    };
  }

  if (validation.status === "invalid") {
    return {
      status: "blocked",
      stage: "configuration-validation",
      issues: validation.issues,
    };
  }

  try {
    const transaction = await options.construct(validation.value);
    return { status: "prepared", transaction };
  } catch {
    return {
      status: "failed",
      stage: "transaction-construction",
      code: "constructor_failed",
    };
  }
}
