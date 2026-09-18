/**
 * Corridor float, in two tiers.
 *
 *   Settlement treasury  — a raw Stellar keypair, server-side, no session.
 *                          Pays every order. Held deliberately thin.
 *   Reserve float        — the operator's own Pollar wallet, where idle USDC
 *                          sits in a Blend pool or DeFindex vault earning yield
 *                          until the settlement treasury needs a top-up.
 *
 * The yield is not a garnish. It is why this corridor can quote 120bps when an
 * operator whose float sleeps in a correspondent account has to charge more:
 * money waiting to be someone's remittance is still working.
 *
 * Deliberately *not* the sender's in-transit USDC. That money belongs to the
 * sender for the sixty seconds it is in their wallet, and depositing it into a
 * yield venue on their behalf is not a thing a remittance operator gets to do.
 *
 * Runs from the operator's authenticated session on /operator.
 */

import type { EarnOpportunity, EarnProviderId, PollarClient, SubmitOutcome } from '@pollar/core';

export interface FloatOpportunity {
  provider: EarnProviderId;
  opportunity: EarnOpportunity;
}

/**
 * Best available yield across every provider the app exposes.
 * An empty provider list means Earn is switched off in the dashboard — the
 * operator page hides the whole panel rather than showing an empty state.
 */
export async function bestYield(client: PollarClient): Promise<FloatOpportunity | null> {
  const providers = await client.getEarnProviders();
  if (!providers.length) return null;

  const all: FloatOpportunity[] = [];
  for (const provider of providers) {
    const opportunities = await client.getEarnOpportunities(provider).catch(() => []);
    for (const opportunity of opportunities) all.push({ provider, opportunity });
  }

  if (!all.length) return null;
  return all.sort((a, b) => Number(b.opportunity.apy ?? 0) - Number(a.opportunity.apy ?? 0))[0];
}

export async function parkFloat(
  client: PollarClient,
  target: FloatOpportunity,
  amount: string,
): Promise<SubmitOutcome> {
  return client.earnDeposit({
    provider: target.provider,
    opportunity: target.opportunity.id,
    amount,
  });
}

/**
 * Pull float back out.
 *
 * Note the withdraw unit differs by provider — Blend withdraws in the
 * underlying asset, DeFindex in vault shares. Read it off the position rather
 * than assuming, or a withdrawal silently moves the wrong amount.
 */
export async function recallFloat(
  client: PollarClient,
  target: FloatOpportunity,
  amount: string,
): Promise<SubmitOutcome> {
  return client.earnWithdraw({
    provider: target.provider,
    opportunity: target.opportunity.id,
    amount,
  });
}

export async function floatPosition(client: PollarClient, target: FloatOpportunity) {
  return client.getEarnPosition({
    provider: target.provider,
    opportunity: target.opportunity.id,
  });
}

/**
 * Settlement treasury low-water mark, in USDC.
 *
 * Below this, the operator page raises a top-up prompt. A corridor that runs
 * its hot wallet dry rejects orders it has already quoted, which is a worse
 * customer experience than a slightly fatter hot wallet is a risk.
 */
export const SETTLEMENT_LOW_WATER = Number(process.env.SETTLEMENT_LOW_WATER ?? 250);
