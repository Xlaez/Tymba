import type { WebAdvancedParameters } from "../web-api/contracts.js";

export function Advanced({ parameters }: { parameters: WebAdvancedParameters }) {
  return (
    <details className="advanced-view">
      <summary>Advanced DBC curve parameters & units · {parameters.candidateId}</summary>
      <p>
        Quantized curve draft only · SDK {parameters.sdkVersion} · unverified. This is not a
        complete SDK config and must not be submitted for deployment. Config-parameter, supply and
        minimum locked-liquidity validation remain pending.
      </p>
      <dl className="metrics">
        <dt>Base / quote decimals</dt>
        <dd>
          {parameters.baseDecimals} / {parameters.quoteDecimals}
        </dd>
        <dt>Total base supply (base atomic)</dt>
        <dd>{parameters.totalBaseAtomic}</dd>
        <dt>Starting sqrt price (u128 Q64.64)</dt>
        <dd>{parameters.startSqrtPriceQ64x64}</dd>
        <dt>Graduation threshold (u64 quote atomic)</dt>
        <dd>{parameters.migrationQuoteThresholdAtomic}</dd>
      </dl>
      <p className="muted">
        An atomic amount is human units × 10^asset decimals. Q64.64 encodes sqrt(quote atomic / base
        atomic) × 2^64; it is not a human price. Liquidity is the protocol’s u128 liquidity scalar,
        not token units or LP-token supply. Segment boundaries set price bands; liquidity determines
        how much base/quote moves through each band.
      </p>
      <div className="table-scroll">
        <table>
          <caption>Exact segment encoding</caption>
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Lower sqrt price · Q64.64</th>
              <th scope="col">Upper sqrt price · Q64.64</th>
              <th scope="col">Liquidity · u128</th>
            </tr>
          </thead>
          <tbody>
            {parameters.segments.map((segment, index) => (
              <tr key={`${segment.lowerSqrtPriceQ64x64}-${segment.upperSqrtPriceQ64x64}`}>
                <th scope="row">{index + 1}</th>
                <td>{segment.lowerSqrtPriceQ64x64}</td>
                <td>{segment.upperSqrtPriceQ64x64}</td>
                <td>{segment.liquidity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Fee and recipient shares are basis points (10,000 bps = 100%). Fee schedules use their
        configured slot or timestamp clock; timestamps and durations are integer seconds. Fee
        changes affect net trade proceeds and modeled fee timing. Activation gates the first
        tradable clock; migration destination identifies the intended adapter, not settled
        destination liquidity. Objective weights rank search candidates and are not on-chain
        parameters. Post-migration LP allocation is unavailable unless measured settlement inputs
        are supplied.
      </p>
      <details>
        <summary>Exact settings & serialized curve snapshot</summary>
        <pre>{JSON.stringify(parameters, null, 2)}</pre>
      </details>
    </details>
  );
}
