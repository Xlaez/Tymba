import { useState } from "react";
import type { WebAttackRequest, WebTradeInput } from "../web-api/contracts.js";
import { Attack } from "./Attack.js";
import { Audit } from "./Audit.js";
import { Simulate } from "./Simulate.js";

export function RiskWorkflow(props: {
  compileRequest: unknown;
  candidateId: string;
  baseSymbol: string;
  quoteSymbol: string;
}) {
  const [trades, setTrades] = useState<readonly WebTradeInput[] | null>(null);
  const [attacks, setAttacks] = useState<readonly WebAttackRequest[]>([]);
  const [revision, setRevision] = useState(0);
  return (
    <>
      <Simulate
        {...props}
        onEvidenceChange={(value) => {
          setTrades(value);
          setRevision((current) => current + 1);
        }}
      />
      <Attack
        compileRequest={props.compileRequest}
        candidateId={props.candidateId}
        onEvidenceChange={(value) => {
          setAttacks(value);
          setRevision((current) => current + 1);
        }}
      />
      <Audit
        key={revision}
        request={{
          compileRequest: props.compileRequest,
          candidateId: props.candidateId,
          attacks,
          ...(trades ? { trades } : {}),
        }}
      />
    </>
  );
}
