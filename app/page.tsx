'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePollar } from '@pollar/react';
import { Rail } from './components/Rail';
import { PayoutPanel } from './components/PayoutPanel';
import type { Order } from '@/lib/orders/types';
import type { CorridorQuote } from '@/lib/corridor/pricing';
import { formatNgn } from '@/lib/corridor/pricing';

export default function Home() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();

  const [ngn, setNgn] = useState('150000');
  const [quote, setQuote] = useState<CorridorQuote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = Number(ngn.replace(/[^\d]/g, ''));

  // Live quote as they type. Debounced — the rate is the first thing a sender
  // looks at and the last thing they should have to ask for.
  useEffect(() => {
    if (!amount) return setQuote(null);
    const t = setTimeout(async () => {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ngnAmount: amount }),
      });
      const data = await res.json();
      setQuote(res.ok ? data : null);
      setError(res.ok ? null : data.error);
    }, 300);
    return () => clearTimeout(t);
  }, [amount]);

  // Poll the order while the legs we do not own are moving.
  useEffect(() => {
    if (!order || ['COMPLETE', 'REFUNDED', 'FAILED'].includes(order.state)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) setOrder(await res.json());
    }, 3000);
    return () => clearInterval(t);
  }, [order]);

  async function startTransfer() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngnAmount: amount,
          senderWallet: wallet.address,
          senderName: name,
          senderEmail: email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrder(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the transfer');
    } finally {
      setBusy(false);
    }
  }

  const advanceOrder = useCallback(
    async (state: 'OFFRAMP_CREATED' | 'BOB_PAID', patch: Partial<Order>, note: string) => {
      if (!order) return;
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, patch, note }),
      });
      if (res.ok) setOrder(await res.json());
    },
    [order],
  );

  async function simulateCredit() {
    if (!order) return;
    await fetch('/api/demo/credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });
  }

  return (
    <>
      <Rail
        state={order?.state}
        detail={order ? order.reference : quote ? `₦${quote.ngnPerUsd.toLocaleString()} / $1` : undefined}
      />

      <main>
        <section>
          <h1>Send naira. They get bolivianos.</h1>
          <p className="note">
            Pay from any Nigerian bank app. Your money crosses on Stellar and lands in Bolivia in
            minutes, not days.
          </p>
        </section>

        {!order ? (
          <>
            <section>
              <label className="field">
                <span>You send</span>
                <input
                  className="amount-input"
                  inputMode="numeric"
                  value={amount ? amount.toLocaleString('en-NG') : ''}
                  onChange={(e) => setNgn(e.target.value)}
                  aria-label="Amount in naira"
                />
              </label>

              {quote ? (
                <dl>
                  <div className="pair">
                    <dt>Converted</dt>
                    <dd>{quote.usdcAmount} USDC</dd>
                  </div>
                  <div className="pair">
                    <dt>Rate</dt>
                    <dd>₦{quote.ngnPerUsd.toLocaleString()} / $1</dd>
                  </div>
                  <div className="pair">
                    <dt>Our margin</dt>
                    <dd>{(quote.spreadBps / 100).toFixed(2)}%</dd>
                  </div>
                  <div className="pair">
                    <dt>Verification needed</dt>
                    <dd>{quote.requiredTier}</dd>
                  </div>
                </dl>
              ) : null}

              {error ? <p className="error">{error}</p> : null}
            </section>

            <section>
              {!isAuthenticated ? (
                <>
                  <h2>Sign in to continue</h2>
                  <p className="note">
                    We create a Stellar wallet for you in the background. No seed phrase, no fees to
                    fund, nothing to install.
                  </p>
                  <button onClick={openLoginModal}>Sign in</button>
                </>
              ) : (
                <>
                  <h2>About you</h2>
                  <label className="field">
                    <span>Your full name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Your email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={startTransfer}
                    disabled={!quote || !name.trim() || !email.trim() || busy}
                  >
                    {busy ? 'Setting it up…' : `Send ${formatNgn(amount)}`}
                  </button>
                </>
              )}
            </section>
          </>
        ) : null}

        {order?.state === 'AWAITING_NGN' && order.virtualAccount ? (
          <section>
            <h2>Transfer {formatNgn(order.ngnAmount)} to this account</h2>
            <div className="account">
              <div className="note">{order.virtualAccount.bankName}</div>
              <div className="account-number">{order.virtualAccount.accountNumber}</div>
              <div className="note">{order.virtualAccount.accountName}</div>
            </div>
            <p className="note">
              This account is yours for this transfer only. It expires with the rate, in 15 minutes.
            </p>
            <button className="quiet" onClick={simulateCredit}>
              Simulate the transfer (sandbox)
            </button>
          </section>
        ) : null}

        {order?.state === 'KYC_PENDING' ? (
          <section>
            <h2>One verification step</h2>
            <p className="note">
              This amount needs {order.requiredTier} verification before it can move. Your naira is
              held and unspent until it clears.
            </p>
            <button
              onClick={() =>
                fetch('/api/kyc/approved', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId: order.id }),
                })
              }
            >
              Complete verification
            </button>
          </section>
        ) : null}

        {order?.state === 'IN_FLIGHT' ? (
          <PayoutPanel order={order} onAdvance={advanceOrder} />
        ) : null}

        {order && ['BOB_PAID', 'COMPLETE'].includes(order.state) ? (
          <section>
            <h2>Delivered</h2>
            <p>
              {order.beneficiary?.fullName} has been paid. <a href={`/receipt/${order.id}`}>View receipt</a>
            </p>
          </section>
        ) : null}

        {order ? (
          <section>
            <h2>What happened</h2>
            <ol className="timeline">
              {order.events.map((e, i) => (
                <li key={i}>
                  <time dateTime={e.at}>
                    {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <span>{e.note ?? e.state}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {isAuthenticated ? (
          <section>
            <p className="note">
              Signed in · {wallet?.address.slice(0, 6)}…{wallet?.address.slice(-6)}{' '}
              <button className="quiet" onClick={logout} style={{ marginLeft: '0.5rem' }}>
                Sign out
              </button>
            </p>
          </section>
        ) : null}
      </main>
    </>
  );
}
