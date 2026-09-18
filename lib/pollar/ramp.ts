/**
 * The Bolivian leg.
 *
 * Runs from the sender's authenticated session, not from our backend, because
 * `createOffRamp` debits the wallet that owns the session. That is the property
 * that makes this corridor non-custodial end to end: naira reaches the operator,
 * USDC reaches the *sender*, and the sender's own wallet pays Bolivia. The
 * operator never holds the user's money on-chain.
 *
 * Verified against @pollar/core 0.11.3. Note the quote query is
 * `{ country, amount, currency, direction }` — the published docs show an older
 * `{ fiatCurrency, cryptoAsset }` shape that the package no longer accepts.
 */

import type { PollarClient, RampQuote, RampTxStatus } from '@pollar/core';
import { CORRIDOR } from '../corridor/pricing';

export type { RampQuote };

/** Rails that publish live liquidity. Only Abroad answers today. */
const LIQUIDITY_RAILS = ['PIX', 'BREB'] as const;
type LiquidityRail = (typeof LIQUIDITY_RAILS)[number];

function publishesLiquidity(rail: string): rail is LiquidityRail {
  return (LIQUIDITY_RAILS as readonly string[]).includes(rail);
}

/**
 * Is a payout rail actually serving right now?
 *
 * Quoting a dry rail succeeds and only fails much further downstream — after
 * the sender's naira is already with us. So this is checked before an order is
 * accepted, not before a payout is attempted.
 *
 * Bolivia's QR rail does not publish liquidity today (only PIX and BREB do), so
 * this returns `unknown` for BOB rather than a confident `true`. The corridor
 * treats unknown as serving, because failing closed on a missing signal would
 * shut the corridor permanently — but the operator page shows it as unknown
 * instead of pretending we checked.
 */
export async function railStatus(
  client: PollarClient,
  rail: string,
): Promise<'serving' | 'dry' | 'unknown'> {
  if (!publishesLiquidity(rail)) return 'unknown';
  try {
    const res = await client.getRampLiquidity(rail);
    return res.available ? 'serving' : 'dry';
  } catch {
    return 'unknown';
  }
}

/**
 * Quote the USDC -> BOB leg.
 *
 * Bolivia settles over the country's interoperable QR standard, which surfaces
 * here as `rail: 'QR'`. Quotes come back sorted by recommendation, best first.
 */
export async function quoteBobPayout(
  client: PollarClient,
  usdcAmount: string,
): Promise<RampQuote[]> {
  const res = await client.getRampsQuote({
    country: CORRIDOR.to.country,
    currency: CORRIDOR.asset,
    amount: Number(usdcAmount),
    direction: 'offramp',
  });
  return res.quotes ?? [];
}

/** What the recipient actually receives, after the provider's fee. */
export function bobDelivered(quote: RampQuote, usdcAmount: string): number {
  const gross = Number(usdcAmount) * quote.rate;
  const fee = quote.feeCurrency === CORRIDOR.to.currency ? quote.fee : quote.fee * quote.rate;
  return Math.max(0, gross - fee);
}

export interface OfframpOutcome {
  txId: string;
  provider: string;
  status: RampTxStatus;
  /** The provider wants identity evidence before it will pay out. */
  kycRequired: boolean;
  /** Some providers host their own flow; others expose no link and are polled. */
  kycUrl?: string;
  stellarTxHash?: string;
}

/**
 * Create the payout.
 *
 * `fields` is filled from `quote.requiredFields` — the provider declares what
 * it needs (labels, input types, select options) and the UI renders it. We do
 * not hardcode a Bolivian beneficiary form, so when the provider adds a field
 * the form grows without a deploy.
 */
export async function createBobPayout(
  client: PollarClient,
  input: {
    quoteId: string;
    usdcAmount: string;
    fullName: string;
    email?: string;
    taxId?: string;
    fields: Record<string, string>;
    walletAddress: string;
  },
): Promise<OfframpOutcome> {
  const res = await client.createOffRamp({
    quoteId: input.quoteId,
    amount: Number(input.usdcAmount),
    currency: CORRIDOR.asset,
    country: CORRIDOR.to.country,
    walletAddress: input.walletAddress,
    fullName: input.fullName,
    email: input.email,
    taxId: input.taxId,
    fields: input.fields,
  });

  return {
    txId: res.txId,
    provider: res.provider,
    status: res.status,
    kycRequired: res.kycRequired === true,
    kycUrl: res.kycUrl,
    stellarTxHash: res.stellarTxHash,
  };
}

/**
 * Wait for the payout to settle.
 *
 * Used for the demo, where somebody is watching. In production a scheduled
 * worker reconciles ramp status instead — a browser tab closing must never
 * orphan a payout.
 */
export async function awaitPayout(client: PollarClient, txId: string): Promise<RampTxStatus> {
  return client.pollRampTransaction(txId, { intervalMs: 5_000, timeoutMs: 600_000 });
}

/**
 * Some providers expose no hosted KYC page. For those, the off-ramp answers
 * `kycRequired: true` and the client waits for approval, then re-quotes —
 * the original quote will have expired by then.
 */
export async function awaitRampKyc(
  client: PollarClient,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const interval = opts.intervalMs ?? 6_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 900_000);

  while (Date.now() < deadline) {
    const status = await client.getRampKycStatus().catch(() => null);
    if (status?.hasApproved) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
