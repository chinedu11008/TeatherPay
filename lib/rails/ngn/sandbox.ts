/**
 * Sandbox rail.
 *
 * Issues plausible NUBANs and verifies webhooks with a shared secret, so the
 * whole corridor runs end to end on a laptop with no provider account and no
 * tunnel. The demo page can fire a credit at it directly.
 *
 * It implements the same interface as the real rail, including signature
 * verification and the idempotency contract — so switching to Paystack is an
 * env var, not a rewrite.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { InboundCredit, NgnRail, PayoutRequest, PayoutResult, VirtualAccount } from './rail';
import { RailError } from './rail';

const SANDBOX_BANKS = [
  { name: 'Wema Bank', code: '035' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Sterling Bank', code: '232' },
];

function secret(): string {
  return process.env.NGN_PROVIDER_WEBHOOK_SECRET ?? 'sandbox-webhook-secret';
}

export function signSandboxWebhook(rawBody: string): string {
  return createHmac('sha512', secret()).update(rawBody).digest('hex');
}

export const sandboxRail: NgnRail = {
  id: 'sandbox',

  async createVirtualAccount({ orderId, customerName }) {
    const bank = SANDBOX_BANKS[randomInt(SANDBOX_BANKS.length)];
    // NUBANs are ten digits. Generated, not derived from the order id — an
    // account number that leaks a sequence is an enumeration problem.
    const accountNumber = String(randomInt(1_000_000_000, 9_999_999_999));
    return {
      bankName: bank.name,
      accountNumber,
      accountName: `ONA/${customerName.slice(0, 20).toUpperCase()}`,
      providerRef: `sbx_${orderId}`,
    };
  },

  async releaseVirtualAccount() {
    // Nothing to release: sandbox accounts are not held anywhere.
  },

  parseWebhook(rawBody, headers) {
    const sent = headers.get('x-ona-signature') ?? '';
    const expected = signSandboxWebhook(rawBody);

    // Constant-time compare. A length mismatch short-circuits, so check it
    // first rather than letting timingSafeEqual throw on unequal buffers.
    const ok =
      sent.length === expected.length &&
      timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (!ok) throw new RailError('BAD_SIGNATURE', 'Webhook signature did not verify');

    const payload = JSON.parse(rawBody) as {
      event?: string;
      data?: Record<string, unknown>;
    };
    if (payload.event !== 'charge.success') return null;

    const d = payload.data ?? {};
    return {
      eventId: String(d.id ?? ''),
      accountNumber: String(d.accountNumber ?? ''),
      amountNgn: Number(d.amount ?? 0),
      senderAccountName: d.senderName ? String(d.senderName) : undefined,
      senderAccountNumber: d.senderAccount ? String(d.senderAccount) : undefined,
      senderBank: d.senderBank ? String(d.senderBank) : undefined,
      receivedAt: new Date().toISOString(),
    };
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    return { providerRef: `sbx_out_${req.reference}`, status: 'success' };
  },

  async resolveAccountName(accountNumber) {
    if (!/^\d{10}$/.test(accountNumber)) return null;
    return 'SANDBOX ACCOUNT HOLDER';
  },
};
