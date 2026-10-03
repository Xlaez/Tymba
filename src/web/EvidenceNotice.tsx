import { evidenceNotices } from "./evidence.js";

export function EvidenceNotice({ stage }: { stage: keyof typeof evidenceNotices }) {
  const notice = evidenceNotices[stage];
  return (
    <div
      className="notice"
      role="note"
      aria-label={`Evidence limits: ${stage}`}
      data-testid={`evidence-${stage}`}
    >
      <strong>{notice.title}</strong>
      <p>{notice.text}</p>
    </div>
  );
}
