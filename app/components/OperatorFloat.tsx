'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePollar } from '@pollar/react';
import type { EarnPosition } from '@pollar/core';
import { bestYield, floatPosition, parkFloat, recallFloat, type FloatOpportunity } from '@/lib/treasury/float';

interface TreasuryApiStatus {
  configured: boolean;
  address?: string;
  balance?: string;
  low?: boolean;
  lowWater?: number;
  usdcIssuer?: string;
  reason?: string;
}

/**
 * Apy is documented only as "live APY" with no stated unit. Every rate-like
 * field elsewhere in this SDK (ramp `quote.rate`) is a plain multiplier, not a
 * pre-multiplied percentage, so this assumes the same convention: 0.052 means
 * 5.2%. Confirm against a real response before a demo leans on this number.
 */
function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

/**
 * The operator's reserve float.
 *
 * A second Pollar wallet — the operator's own, signed in separately from any
 * sender. Idle USDC sits here in a Blend pool or DeFindex vault earning yield
 * until the settlement treasury (a plain Stellar keypair, see
 * lib/treasury/stellar.ts) needs a top-up. Two identities, two purposes: the
 * settlement treasury pays orders and is kept thin; this wallet is where
 * uncommitted capital works instead of sitting idle.
 */
export function OperatorFloat() {
  const { isAuthenticated, wallet, walletBalance, refreshWalletBalance, openLoginModal, getClient, runTx } =
    usePollar();

  const [earnEnabled, setEarnEnabled] = useState<boolean | null>(null);
  const [target, setTarget] = useState<FloatOpportunity | null>(null);
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [treasury, setTreasury] = useState<TreasuryApiStatus | null>(null);

  const [amount, setAmount] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [busy, setBusy] = useState<'parking' | 'recalling' | 'topping-up' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTreasury = useCallback(async () => {
    const res = await fetch('/api/treasury/status');
    setTreasury(await res.json());
  }, []);

  useEffect(() => {
    void loadTreasury();
  }, [loadTreasury]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshWalletBalance();

    (async () => {
      const client = getClient();
      const providers = await client.getEarnProviders().catch(() => []);
      setEarnEnabled(providers.length > 0);

      const opp = await bestYield(client);
      setTarget(opp);
      if (opp) setPosition(await floatPosition(client, opp).catch(() => null));
    })();
  }, [isAuthenticated, getClient, refreshWalletBalance]);

  const idleUsdc =
    walletBalance.step === 'loaded'
      ? (walletBalance.data.balances.find((b) => b.code === 'USDC')?.balance ?? '0')
      : '—';

  async function park() {
    if (!target || !amount) return;
    setBusy('parking');
    setError(null);
    setNotice(null);
    try {
      const client = getClient();
      const outcome = await parkFloat(client, target, amount);
      if (outcome.status === 'error') throw new Error('Deposit was not accepted');

      setNotice(`Parked ${amount} ${target.opportunity.symbol ?? target.opportunity.asset.code}`);
      setAmount('');
      setPosition(await floatPosition(client, target).catch(() => null));
      await refreshWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not park float');
    } finally {
      setBusy(null);
    }
  }

  async function recall() {
    if (!target || !position || Number(position.withdrawable) <= 0) return;
    setBusy('recalling');
    setError(null);
    setNotice(null);
    try {
      const client = getClient();
      const outcome = await recallFloat(client, target, position.withdrawable);
      if (outcome.status === 'error') throw new Error('Withdrawal was not accepted');

      setNotice('Recalled the full position');
      setPosition(await floatPosition(client, target).catch(() => null));
      await refreshWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not recall float');
    } finally {
      setBusy(null);
    }
  }

  async function topUp() {
    if (!treasury?.configured || !treasury.usdcIssuer || !treasury.address || !topUpAmount) return;
    setBusy('topping-up');
    setError(null);
    setNotice(null);
    try {
      const outcome = await runTx('payment', {
        destination: treasury.address,
        amount: topUpAmount,
        asset: { type: 'credit_alphanum4', code: 'USDC', issuer: treasury.usdcIssuer },
      });
      if (outcome.status === 'error') throw new Error('Transfer was not accepted');

      setNotice(`Sent ${topUpAmount} USDC to settlement`);
      setTopUpAmount('');
      await loadTreasury();
      await refreshWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the settlement treasury');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2>Reserve float</h2>
      <p className="note">
        A second Pollar wallet — the operator&rsquo;s own, signed in separately from any sender.
      </p>

      {!isAuthenticated ? (
        <button onClick={openLoginModal}>Sign in as operator</button>
      ) : (
        <>
          <dl>
            <div className="pair">
              <dt>Wallet</dt>
              <dd>
                {wallet?.address.slice(0, 6)}…{wallet?.address.slice(-6)}
              </dd>
            </div>
            <div className="pair">
              <dt>Idle USDC</dt>
              <dd>{idleUsdc}</dd>
            </div>
          </dl>

          {earnEnabled === false ? (
            <p className="note">Earn isn&rsquo;t enabled for this app — turn it on under Treasury → Earn.</p>
          ) : target ? (
            <>
              <dl>
                <div className="pair">
                  <dt>Best rate</dt>
                  <dd>
                    {target.opportunity.name} · {formatApy(target.opportunity.apy)}
                  </dd>
                </div>
                {position ? (
                  <div className="pair">
                    <dt>Parked</dt>
                    <dd>
                      {position.balance} {target.opportunity.symbol ?? target.opportunity.asset.code}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <label className="field">
                <span>Amount to park</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button onClick={park} disabled={!amount || busy !== null}>
                {busy === 'parking' ? 'Parking…' : `Park in ${target.opportunity.name}`}
              </button>

              {position && Number(position.withdrawable) > 0 ? (
                <button
                  className="quiet"
                  onClick={recall}
                  disabled={busy !== null}
                  style={{ marginLeft: '0.5rem' }}
                >
                  {busy === 'recalling' ? 'Recalling…' : `Recall ${position.withdrawable}`}
                </button>
              ) : null}
            </>
          ) : earnEnabled === true ? (
            <p className="note">Earn is enabled, but no opportunities are live right now.</p>
          ) : (
            <p className="note">Checking Earn opportunities…</p>
          )}

          {treasury?.configured ? (
            <div style={{ marginTop: '1.25rem' }}>
              <dl>
                <div className="pair">
                  <dt>Settlement treasury</dt>
                  <dd style={{ color: treasury.low ? 'var(--lapaz)' : undefined }}>
                    {treasury.balance} USDC{treasury.low ? ' — below low-water mark' : ''}
                  </dd>
                </div>
              </dl>
              <label className="field">
                <span>Top up settlement</span>
                <input
                  inputMode="decimal"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button className="quiet" onClick={topUp} disabled={!topUpAmount || busy !== null}>
                {busy === 'topping-up' ? 'Sending…' : 'Send to settlement'}
              </button>
            </div>
          ) : (
            <p className="note">
              Settlement treasury not configured — run <code>npm run setup:treasury</code>.
            </p>
          )}

          {notice ? <p className="note">{notice}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
