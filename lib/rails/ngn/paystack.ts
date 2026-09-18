/**
 * Paystack rail — dedicated virtual accounts (NUBAN) in, transfers out.
 *
 * Chosen as the primary rail because the sender's flow is a habit they already
 * have: open bank app, paste a ten-digit account number, send. NIP settles in
 * seconds and every Nigerian bank app can reach it. No new behaviour to teach,
 * which is worth more than any feature.
 *
 * Swap for Monnify or Flutterwave by implementing NgnRail against their API —
 * all three expose the same three primitives.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundCredit, NgnRail, PayoutRequest, PayoutResult, VirtualAccount } from './rail';
import { RailError } from './rail';

const BASE = 'https://api.paystack.co';

function key(): string {
  const k = process.env.NGN_PROVIDER_SECRET_KEY;
  if (!k) throw new RailError('NO_CREDENTIALS', 'NGN_PROVIDER_SECRET_KEY is not set');
  return k;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json()) as { status?: boolean; message?: string; data?: unknown };
  if (!res.ok || body.status === false) {
    throw new RailError('PROVIDER_ERROR', body.message ?? `Paystack returned ${res.status}`);
  }
  return body.data as T;
}

export const paystackRail: NgnRail = {
  id: 'paystack',

  async createVirtualAccount({ reference, customerName, customerEmail }): Promise<VirtualAccount> {
    const [firstName, ...rest] = customerName.trim().split(/\s+/);

    const customer = await call<{ customer_code: string }>('/customer', {
      method: 'POST',
      body: JSON.stringify({
        email: customerEmail,
        first_name: firstName,
        last_name: rest.join(' ') || firstName,
      }),
    });

    const account = await call<{
      bank: { name: string };
      account_number: string;
      account_name: string;
      id: number;
    }>('/dedicated_account', {
      method: 'POST',
      body: JSON.stringify({
        customer: customer.customer_code,
        preferred_bank: process.env.NGN_PREFERRED_BANK ?? 'wema-bank',
      }),
    });

    return {
      bankName: account.bank.name,
      accountNumber: account.account_number,
      accountName: account.account_name,
      providerRef: String(account.id),
    };
  },

  async releaseVirtualAccount(providerRef) {
    // Accounts are single-use per order; deactivating returns them to the pool
    // and stops a stale account number from ever crediting a closed order.
    await call(`/dedicated_account/${providerRef}`, { method: 'DELETE' }).catch(() => {});
  },

  parseWebhook(rawBody, headers) {
    const sent = headers.get('x-paystack-signature') ?? '';
    const expected = createHmac('sha512', key()).update(rawBody).digest('hex');

    const ok =
      sent.length === expected.length &&
      timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (!ok) throw new RailError('BAD_SIGNATURE', 'Webhook signature did not verify');

    const payload = JSON.parse(rawBody) as {
      event?: string;
      data?: Record<string, any>;
    };

    // Only act on successful credits into a dedicated account. Every other
    // event type is acknowledged and ignored.
    if (payload.event !== 'charge.success') return null;
    const d = payload.data ?? {};
    if (d.channel !== 'dedicated_nuban') return null;

    return {
      eventId: String(d.id),
      accountNumber: String(d.authorization?.receiver_bank_account_number ?? ''),
      // Paystack amounts are in kobo.
      amountNgn: Number(d.amount ?? 0) / 100,
      senderAccountName: d.authorization?.account_name ?? undefined,
      senderAccountNumber: d.authorization?.sender_bank_account_number ?? undefined,
      senderBank: d.authorization?.sender_bank ?? undefined,
      receivedAt: d.paid_at ?? new Date().toISOString(),
    };
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    const recipient = await call<{ recipient_code: string }>('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        account_number: req.accountNumber,
        bank_code: req.bankCode,
        currency: 'NGN',
      }),
    });

    const transfer = await call<{ transfer_code: string; status: string }>('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(req.amountNgn * 100),
        recipient: recipient.recipient_code,
        reference: req.reference,
        reason: req.narration,
      }),
    });

    return {
      providerRef: transfer.transfer_code,
      status: transfer.status === 'success' ? 'success' : 'queued',
    };
  },

  async resolveAccountName(accountNumber, bankCode) {
    try {
      const data = await call<{ account_name: string }>(
        `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      );
      return data.account_name;
    } catch {
      // A name that will not resolve is a payout that would have failed after
      // the money moved. Surfacing null here fails it before.
      return null;
    }
  },
};
