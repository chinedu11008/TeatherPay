'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePollar } from '@pollar/react';
import type { RampQuote } from '@pollar/core';
import {
  awaitPayout,
  awaitRampKyc,
  bobDelivered,
  createBobPayout,
  quoteBobPayout,
} from '@/lib/pollar/ramp';
import { formatBob } from '@/lib/corridor/pricing';
import type { Order } from '@/lib/orders/types';

/**
 * The Bolivian leg, driven from the sender's own session.
 *
 * The beneficiary form is not written by us. Every quote carries
 * `requiredFields` — the provider declares what it needs, with labels, input
 * types and select options — and this renders it. When the anchor adds a field
 * the form grows without a deploy, and adding a second Latin American
 * destination needs no new form at all.
 */
export function PayoutPanel({
  order,
  onAdvance,
}: {
  order: Order;
  onAdvance: (state: 'OFFRAMP_CREATED' | 'BOB_PAID', patch: Partial<Order>, note: string) => void;
}) {
  const { getClient, wallet } = usePollar();
  const [quotes, setQuotes] = useState<RampQuote[] | null>(null);
  const [chosen, setChosen] = useState<RampQuote | null>(null);
  const [fullName, setFullName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQuotes = useCallback(async () => {
    setError(null);
    try {
      const result = await quoteBobPayout(getClient(), order.usdcAmount);
      setQuotes(result);
      setChosen(result.find((q) => q.recommended) ?? result[0] ?? null);
      if (!result.length) {
        setError('No Bolivian payout route is available for this amount right now.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the payout provider');
    }
  }, [getClient, order.usdcAmount]);

  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes]);

  async function send() {
    if (!chosen || !wallet) return;
    setBusy('Creating the payout');
    setError(null);

    try {
      const outcome = await createBobPayout(getClient(), {
        quoteId: chosen.quoteId,
        usdcAmount: order.usdcAmount,
        fullName,
        fields,
        walletAddress: wallet.address,
      });

      // Some anchors expose no hosted KYC page: the off-ramp comes back
      // asking for verification, nothing was signed, and no funds moved.
      // Wait for approval, then re-quote — the original quote is 15 minutes
      // old by then and will not be honoured.
      if (outcome.kycRequired && !outcome.kycUrl) {
        setBusy('Waiting for the provider to verify the recipient');
        const approved = await awaitRampKyc(getClient());
        if (!approved) {
          setError('Verification did not clear in time. Your USDC is untouched.');
          setBusy(null);
          return;
        }
        await loadQuotes();
        setBusy(null);
        setError('Verified. Confirm again to send at the refreshed rate.');
        return;
      }

      if (outcome.kycUrl) {
        window.open(outcome.kycUrl, '_blank', 'noopener');
      }

      const bob = bobDelivered(chosen, order.usdcAmount);
      onAdvance(
        'OFFRAMP_CREATED',
        {
          rampTxId: outcome.txId,
          rampQuoteId: chosen.quoteId,
          rampRail: chosen.rail,
          bobAmount: bob,
          beneficiary: { fullName, fields },
        },
        `Payout queued with ${outcome.provider} over ${chosen.rail}`,
      );

      setBusy('Waiting for the bolivianos to land');
      const status = await awaitPayout(getClient(), outcome.txId);

      if (status === 'completed') {
        onAdvance('BOB_PAID', { bobAmount: bob }, `${formatBob(bob)} delivered`);
      } else {
        setError(`The anchor reported "${status}". Reference ${outcome.txId}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payout could not be created');
    } finally {
      setBusy(null);
    }
  }

  if (!quotes) return <p className="note">Finding a route into Bolivia…</p>;

  const ready = chosen && fullName.trim() &&
    chosen.requiredFields.every((f) => f.optional || fields[f.key]?.trim());

  return (
    <section>
      <h2>Who receives it</h2>

      {chosen ? (
        <dl>
          <div className="pair">
            <dt>They receive</dt>
            <dd>{formatBob(bobDelivered(chosen, order.usdcAmount))}</dd>
          </div>
          <div className="pair">
            <dt>Route</dt>
            <dd>
              {chosen.provider} · {chosen.rail} · {chosen.estimatedTime}
            </dd>
          </div>
          <div className="pair">
            <dt>Anchor fee</dt>
            <dd>
              {chosen.fee} {chosen.feeCurrency}
            </dd>
          </div>
        </dl>
      ) : null}

      {quotes.length > 1 ? (
        <label className="field">
          <span>Route</span>
          <select
            value={chosen?.quoteId ?? ''}
            onChange={(e) =>
              setChosen(quotes.find((q) => q.quoteId === e.target.value) ?? null)
            }
          >
            {quotes.map((q) => (
              <option key={q.quoteId} value={q.quoteId}>
                {q.provider} — {formatBob(bobDelivered(q, order.usdcAmount))} in {q.estimatedTime}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="field">
        <span>Recipient&rsquo;s full name</span>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="As it appears on their ID"
          autoComplete="off"
        />
      </label>

      {/* Provider-declared fields. Not our schema — theirs. */}
      {chosen?.requiredFields.map((f) => (
        <label className="field" key={f.key}>
          <span>
            {f.label}
            {f.optional ? ' (optional)' : ''}
          </span>
          {f.type === 'select' ? (
            <select
              value={fields[f.key] ?? ''}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
            >
              <option value="">Choose…</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type}
              value={fields[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          )}
          {f.hint ? <span className="note">{f.hint}</span> : null}
        </label>
      ))}

      {error ? <p className="error">{error}</p> : null}

      <button onClick={send} disabled={!ready || busy !== null}>
        {busy ?? `Send ${chosen ? formatBob(bobDelivered(chosen, order.usdcAmount)) : ''}`}
      </button>
    </section>
  );
}
