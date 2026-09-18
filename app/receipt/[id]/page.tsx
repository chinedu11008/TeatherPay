import { notFound } from 'next/navigation';
import { getOrder } from '@/lib/orders/store';
import { explorerTxUrl } from '@/lib/treasury/stellar';
import { formatBob, formatNgn } from '@/lib/corridor/pricing';

/**
 * The receipt.
 *
 * Generated from the append-only event log, not from mutable order fields, so
 * it cannot show a history that did not happen. The Stellar hash is the point:
 * if Ọ̀nà disappeared tomorrow, the sender could still prove what moved and
 * when, from a public ledger, without our cooperation. Remittance users have
 * been burned by operators before.
 */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  return (
    <main style={{ paddingTop: '3rem' }}>
      <h1>{order.reference}</h1>
      <p className="note">
        {new Date(order.createdAt).toLocaleString()} · {order.state.toLowerCase().replace('_', ' ')}
      </p>

      <section>
        <dl>
          <div className="pair">
            <dt>Sent</dt>
            <dd>{formatNgn(order.ngnAmount)}</dd>
          </div>
          <div className="pair">
            <dt>Converted</dt>
            <dd>{order.usdcAmount} USDC</dd>
          </div>
          <div className="pair">
            <dt>Rate</dt>
            <dd>₦{order.ngnPerUsd.toLocaleString()} / $1 + {(order.spreadBps / 100).toFixed(2)}%</dd>
          </div>
          {order.bobAmount ? (
            <div className="pair">
              <dt>Delivered</dt>
              <dd>{formatBob(order.bobAmount)}</dd>
            </div>
          ) : null}
          {order.beneficiary ? (
            <div className="pair">
              <dt>Recipient</dt>
              <dd>{order.beneficiary.fullName}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section>
        <h2>Proof</h2>
        <dl>
          {order.settlementHash ? (
            <div className="pair">
              <dt>Stellar</dt>
              <dd>
                <a href={explorerTxUrl(order.settlementHash)} target="_blank" rel="noreferrer">
                  {order.settlementHash.slice(0, 12)}…
                </a>
              </dd>
            </div>
          ) : null}
          {order.rampTxId ? (
            <div className="pair">
              <dt>Payout reference</dt>
              <dd>{order.rampTxId}</dd>
            </div>
          ) : null}
          {order.rampRail ? (
            <div className="pair">
              <dt>Bolivian rail</dt>
              <dd>{order.rampRail}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section>
        <h2>What happened</h2>
        <ol className="timeline">
          {order.events.map((e, i) => (
            <li key={i}>
              <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
              <span>{e.note ?? e.state}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
