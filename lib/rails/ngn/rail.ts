/**
 * The Nigerian rail adapter contract.
 *
 * Everything above this interface — the order machine, the corridor, the UI —
 * is provider-agnostic. Adding Ghana (mobile money) or Kenya (M-Pesa) is a new
 * implementation of this file, not a change to anything that consumes it.
 *
 * Three concrete implementations ship here:
 *   sandbox.ts   — self-contained, no network, so the repo runs out of the box
 *   paystack.ts  — dedicated virtual accounts (NUBAN) + transfers
 *   agent.ts     — human agent cash-in against pre-funded float
 */

export interface VirtualAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Provider's handle, needed to release the account when the order closes. */
  providerRef: string;
}

export interface InboundCredit {
  /** Provider event id. The idempotency key for the whole system. */
  eventId: string;
  accountNumber: string;
  amountNgn: number;
  /** Who sent it — shown on the receipt, used for the refund path. */
  senderAccountName?: string;
  senderAccountNumber?: string;
  senderBank?: string;
  receivedAt: string;
}

export interface PayoutRequest {
  accountNumber: string;
  bankCode: string;
  amountNgn: number;
  reference: string;
  narration: string;
}

export interface PayoutResult {
  providerRef: string;
  status: 'queued' | 'success' | 'failed';
  failureReason?: string;
}

export interface NgnRail {
  readonly id: string;

  /** Issue a single-use account number for one order. */
  createVirtualAccount(input: {
    orderId: string;
    reference: string;
    customerName: string;
    customerEmail: string;
  }): Promise<VirtualAccount>;

  /** Release it once the order reaches a terminal state. */
  releaseVirtualAccount(providerRef: string): Promise<void>;

  /**
   * Verify a webhook and parse it into a credit, or null if it is an event
   * type we do not act on. Throws if the signature does not verify — an
   * unverified payload is never allowed to reach the order machine.
   */
  parseWebhook(rawBody: string, headers: Headers): InboundCredit | null;

  /** Reverse direction: pay naira out to a Nigerian bank account. */
  payout(req: PayoutRequest): Promise<PayoutResult>;

  /** Confirm a recipient's account name before money moves, not after. */
  resolveAccountName(accountNumber: string, bankCode: string): Promise<string | null>;
}

export class RailError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RailError';
  }
}
