import { NextResponse } from 'next/server';
import { advance, claimEvent, findByVirtualAccount } from '@/lib/orders/store';
import { ngnRail, RailError } from '@/lib/rails/ngn';
import { tierSatisfies } from '@/lib/corridor/pricing';
import { settleOrder } from '@/lib/orders/settle';

/**
 * Inbound naira.
 *
 * Contract with the provider: acknowledge fast, never 500 on a duplicate, and
 * never let an unverified payload reach the order machine. Providers retry
 * aggressively — a single credit routinely arrives three or four times — so
 * every path through here is idempotent on the provider's own event id.
 */
export async function POST(req: Request) {
  // Read the raw body: the signature covers bytes, not a re-serialised object.
  const raw = await req.text();

  let credit;
  try {
    credit = ngnRail().parseWebhook(raw, req.headers);
  } catch (err) {
    if (err instanceof RailError && err.code === 'BAD_SIGNATURE') {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Unreadable payload' }, { status: 400 });
  }

  // An event type we do not act on. Acknowledged so the provider stops retrying.
  if (!credit) return NextResponse.json({ ok: true, ignored: true });

  const order = await findByVirtualAccount(credit.accountNumber);
  if (!order) {
    // Not ours, or the order already moved on. Acknowledge either way —
    // returning an error here just makes the provider retry forever.
    return NextResponse.json({ ok: true, unmatched: true });
  }

  // Claim the event id before doing anything that moves money.
  if (!(await claimEvent(order.id, credit.eventId))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Underpayment is not a transfer. Over-payment settles at the quoted amount
  // and the difference is refunded — silently upgrading the order would mean
  // honouring a rate for money we did not quote.
  if (credit.amountNgn < order.ngnAmount) {
    await advance(
      order.id,
      'NGN_RECEIVED',
      {
        failure: {
          code: 'UNDERPAID',
          detail: `Expected ₦${order.ngnAmount}, received ₦${credit.amountNgn}`,
        },
      },
      'Amount did not match the quote',
    );
    return NextResponse.json({ ok: true, underpaid: true });
  }

  const received = await advance(
    order.id,
    'NGN_RECEIVED',
    {
      virtualAccount: order.virtualAccount,
    },
    `₦${credit.amountNgn.toLocaleString()} received${
      credit.senderAccountName ? ` from ${credit.senderAccountName}` : ''
    }`,
  );

  // Tier check. The sender's held tier comes from our own KYC record, never
  // from anything the client asserts.
  const heldTier = await heldTierFor(received.senderWallet!);
  if (!tierSatisfies(heldTier, received.requiredTier)) {
    await advance(
      order.id,
      'KYC_PENDING',
      {},
      `Verification required: ${received.requiredTier}`,
    );
    return NextResponse.json({ ok: true, kycRequired: true });
  }

  // Settle without blocking the acknowledgement. The provider gets its 200
  // immediately; settlement failures land on the order, not on the webhook.
  void settleOrder(order.id).catch(() => {});

  return NextResponse.json({ ok: true });
}

/**
 * The sender's verified tier.
 *
 * Stubbed to the basic tier for the hackathon so the happy path runs without a
 * KYC provider account. Wire to `pollar.getKycStatus()` plus your own record of
 * which level cleared — see app/api/kyc/approved/route.ts.
 */
async function heldTierFor(_wallet: string): Promise<'none' | 'basic' | 'intermediate' | 'enhanced'> {
  return (process.env.DEMO_ASSUMED_TIER as 'basic') ?? 'basic';
}
