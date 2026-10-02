export type DeploymentStatus =
  | "prepared"
  | "awaiting-user-approval"
  | "rejected"
  | "submitted"
  | "confirmed"
  | "verified"
  | "failed";

export type DeploymentApproval = Readonly<{
  status: "pending" | "approved" | "rejected";
  recordedAtSeconds?: bigint;
  approverAddress?: string;
}>;

export type DeploymentVerificationStatus =
  | "not-started"
  | "pending"
  | "verified"
  | "mismatch"
  | "failed";

export type DeploymentMismatch = Readonly<{
  path: string;
  expected: string;
  actual: string;
}>;

export type DeploymentVerification = Readonly<{
  status: DeploymentVerificationStatus;
  checkedAtSlot?: bigint;
  mismatches: readonly DeploymentMismatch[];
}>;

export type DeploymentRecord = Readonly<{
  id: string;
  candidateId: string;
  network: "devnet";
  status: DeploymentStatus;
  approval: DeploymentApproval;
  configAddress?: string;
  poolAddress?: string;
  transactionSignatures: readonly string[];
  engineVersion: string;
  sdkVersion: string;
  preparedAtSeconds: bigint;
  submittedAtSeconds?: bigint;
  confirmedSlot?: bigint;
  verifiedAtSeconds?: bigint;
  verification: DeploymentVerification;
}>;
