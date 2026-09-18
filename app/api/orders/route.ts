import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { advance, createOrder, listOrders, newReference } from '@/lib/orders/store';
import type { Order } from '@/lib/orders/types';
import { quoteNgnToUsdc } from '@/lib/corridor/pricing';
import { ngnRail } from '@/lib/rails/ngn';
import { canSettle } from '@/lib/treasury/stellar';

interface CreateBody {
  ngnAmount: number;
  senderWallet: string;
  senderName: string;
  senderEmail: string;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const { ngnAmount, senderWallet, senderName, senderEmail } = body;

  if (!/^G[A-Z2-7]{55}$/.test(senderWallet ?? '')) {
    return NextResponse.json({ error: 'Sign in before starting a transfer' }, { status: 401 });
  }
  if (!senderName?.trim() || !senderEmail?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  let quote;
  try {
    quote = await quoteNgnToUsdc(ngnAmount);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not price this transfer' },
      { status: 400 },
    );
  }

  // Check we can settle *before* issuing an account number. Accepting naira we
  // cannot convert is the worst failure this system has — it turns a payment
  // into a refund and a support ticket.
  if (!(await canSettle(quote.usdcAmount))) {
    return NextResponse.json(
      { error: 'The corridor is at capacity right now. Try a smaller amount or come back shortly.' },
      { status: 503 },
    );
  }

  const id = randomUUID();
  const reference = newReference();

  const order: Order = {
    id,
    reference,
    state: 'QUOTED',
    createdAt: new Date().toISOString(),
    ngnAmount: quote.ngnAmount,
    rail: 'virtual_account',
    appliedEvents: [],
    usdcAmount: quote.usdcAmount,
    ngnPerUsd: quote.ngnPerUsd,
    spreadBps: quote.spreadBps,
    quoteExpiresAt: quote.expiresAt,
    requiredTier: quote.requiredTier,
    senderWallet,
    events: [{ at: new Date().toISOString(), state: 'QUOTED', note: 'Rate locked' }],
  };

  await createOrder(order);

  try {
    const account = await ngnRail().createVirtualAccount({
      orderId: id,
      reference,
      customerName: senderName,
      customerEmail: senderEmail,
    });

    const funded = await advance(
      id,
      'AWAITING_NGN',
      { virtualAccount: account },
      `Account issued on ${account.bankName}`,
    );
    return NextResponse.json(funded, { status: 201 });
  } catch (err) {
    await advance(
      id,
      'FAILED',
      { failure: { code: 'RAIL_UNAVAILABLE', detail: String(err) } },
      'Could not issue an account number',
    );
    return NextResponse.json(
      { error: 'Could not issue an account number. Nothing was charged.' },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json(await listOrders());
}
