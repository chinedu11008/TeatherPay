/**
 * One transfer = one Order. Every state change is an append-only event.
 *
 * The machine is deliberately explicit: no state is inferred from another
 * service's state. If the ledger says NGN_RECEIVED, it is because we saw and
 * verified an inbound webhook, not because a balance looked different.
 */

export const ORDER_STATES = [
  'QUOTED',          // rate locked, virtual account issued
  'AWAITING_NGN',    // sender has the account number, funds not yet in
  'NGN_RECEIVED',    // inbound verified and matched
  'KYC_PENDING',     // tier check failed open, awaiting verification
  'SETTLING',        // treasury -> sender wallet on Stellar
  'IN_FLIGHT',       // USDC in sender's wallet, awaiting off-ramp
  'OFFRAMP_CREATED', // Pollar off-ramp accepted, BOB payout queued
  'BOB_PAID',        // recipient paid
  'COMPLETE',        // receipt issued, order closed
  'FAILED',
  'REFUNDED',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

/**
 * Legal transitions. Anything not listed here is a bug, and `advance()`
 * throws rather than silently writing an impossible history.
 */
const TRANSITIONS: Record<OrderState, OrderState[]> = {
  QUOTED: ['AWAITING_NGN', 'FAILED'],
  AWAITING_NGN: ['NGN_RECEIVED', 'FAILED'],
  NGN_RECEIVED: ['KYC_PENDING', 'SETTLING', 'REFUNDED'],
  KYC_PENDING: ['SETTLING', 'REFUNDED'],
  SETTLING: ['IN_FLIGHT', 'REFUNDED'],
  IN_FLIGHT: ['OFFRAMP_CREATED', 'REFUNDED'],
  OFFRAMP_CREATED: ['BOB_PAID', 'REFUNDED'],
  BOB_PAID: ['COMPLETE'],
  COMPLETE: [],
  FAILED: ['REFUNDED'],
  REFUNDED: [],
};

export function canAdvance(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * States where the sender's naira is already with us. A failure at or after
 * this point owes the sender a refund in NGN, never a USDC balance they did
 * not ask for.
 */
export function isRefundable(state: OrderState): boolean {
  return ['NGN_RECEIVED', 'KYC_PENDING', 'SETTLING', 'IN_FLIGHT', 'OFFRAMP_CREATED'].includes(state);
}

export type KycTier = 'basic' | 'intermediate' | 'enhanced';

export interface Beneficiary {
  fullName: string;
  /** Provider-declared fields from `quote.requiredFields`, keyed by field.key. */
  fields: Record<string, string>;
  email?: string;
  taxId?: string;
  bankDetails?: { type: 'CLABE' | 'PIX' | 'PSE' | 'ACH' | 'BREB'; value: string };
}

export interface OrderEvent {
  at: string;              // ISO 8601
  state: OrderState;
  note?: string;
  data?: Record<string, unknown>;
}

export interface Order {
  id: string;
  /** Short human reference. Goes in the Stellar memo and on the receipt. */
  reference: string;
  state: OrderState;
  createdAt: string;

  // --- Nigerian leg -------------------------------------------------------
  ngnAmount: number;
  rail: 'virtual_account' | 'agent_cash';
  virtualAccount?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    /** Provider handle, needed to release the account when the order closes. */
    providerRef: string;
  };
  agentId?: string;
  /** Provider event ids already applied. Inbound webhooks are idempotent on this. */
  appliedEvents: string[];

  // --- Corridor -----------------------------------------------------------
  usdcAmount: string;      // decimal string, Stellar-native precision
  ngnPerUsd: number;
  spreadBps: number;
  quoteExpiresAt: string;
  requiredTier: KycTier;

  // --- Stellar ------------------------------------------------------------
  senderWallet?: string;   // G-address from the Pollar session
  settlementHash?: string;

  // --- Bolivian leg -------------------------------------------------------
  bobAmount?: number;
  beneficiary?: Beneficiary;
  rampQuoteId?: string;
  rampTxId?: string;
  rampRail?: string;

  // --- Float --------------------------------------------------------------
  earnPosition?: { provider: string; opportunity: string; amount: string };

  failure?: { code: string; detail?: string };
  events: OrderEvent[];
}

export class OrderTransitionError extends Error {
  constructor(
    readonly orderId: string,
    readonly from: OrderState,
    readonly to: OrderState,
  ) {
    super(`Order ${orderId}: ${from} cannot advance to ${to}`);
    this.name = 'OrderTransitionError';
  }
}
