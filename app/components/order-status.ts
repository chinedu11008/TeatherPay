import type { OrderState } from '@/lib/orders/types';

/**
 * Where a state sits on the corridor, Lagos (0) to La Paz (1).
 *
 * This is the one status system in the whole app. The sender's rail and the
 * operator's queue both read off it, so "still in Nigeria" means the same
 * position and the same colour everywhere a state is shown.
 */
export const RAIL_POSITION: Record<OrderState, number> = {
  QUOTED: 0.02,
  AWAITING_NGN: 0.08,
  NGN_RECEIVED: 0.28,
  KYC_PENDING: 0.28,
  SETTLING: 0.45,
  IN_FLIGHT: 0.6,
  OFFRAMP_CREATED: 0.8,
  BOB_PAID: 0.97,
  COMPLETE: 1,
  FAILED: 0.08,
  REFUNDED: 0.02,
};

export const STATE_CAPTION: Record<OrderState, string> = {
  QUOTED: 'Rate locked',
  AWAITING_NGN: 'Waiting for naira',
  NGN_RECEIVED: 'Naira received',
  KYC_PENDING: 'Verification needed',
  SETTLING: 'Converting to USDC',
  IN_FLIGHT: 'On Stellar',
  OFFRAMP_CREATED: 'Payout queued',
  BOB_PAID: 'Bolivianos delivered',
  COMPLETE: 'Done',
  FAILED: 'Stopped, nothing charged',
  REFUNDED: 'Refunded',
};

export function railColour(position: number): string {
  if (position < 0.35) return 'var(--lagos)';
  if (position < 0.75) return 'var(--transit)';
  return 'var(--lapaz)';
}

export function stateColour(state: OrderState): string {
  if (state === 'FAILED' || state === 'REFUNDED') return 'var(--muted)';
  return railColour(RAIL_POSITION[state]);
}
