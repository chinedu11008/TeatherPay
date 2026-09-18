'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Order } from '@/lib/orders/types';
import { STATE_CAPTION, stateColour } from './order-status';
import { formatNgn } from '@/lib/corridor/pricing';

/**
 * Every order, newest first.
 *
 * The only action here is approving a KYC-gated order — everything else in
 * the machine advances itself (a webhook, a settlement, a client-driven
 * off-ramp). If an operator needs a button to do it, it's because our own
 * automation stalled, and that is worth seeing, not hiding behind a refresh.
 */
export function OrderQueue() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/orders');
    if (res.ok) setOrders(await res.json());
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function approve(orderId: string) {
    setActing(orderId);
    try {
      await fetch('/api/kyc/approved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  if (!orders) return <p className="note">Loading orders…</p>;
  if (!orders.length) return <p className="note">No transfers yet.</p>;

  return (
    <table className="queue">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Sent</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>
              <a href={`/receipt/${o.id}`}>{o.reference}</a>
            </td>
            <td>{formatNgn(o.ngnAmount)}</td>
            <td>
              <span className="dot" style={{ background: stateColour(o.state) }} />
              {STATE_CAPTION[o.state]}
              {o.failure ? <span className="note"> — {o.failure.detail}</span> : null}
            </td>
            <td>
              {o.state === 'KYC_PENDING' ? (
                <button
                  className="quiet"
                  onClick={() => approve(o.id)}
                  disabled={acting === o.id}
                >
                  {acting === o.id ? 'Approving…' : 'Approve & activate'}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
