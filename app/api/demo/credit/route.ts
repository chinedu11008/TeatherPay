import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrder } from '@/lib/orders/store';
import { signSandboxWebhook } from '@/lib/rails/ngn';

/**
 * Fire a signed sandbox credit at our own webhook.
 *
 * This exists so the corridor can be run end to end on a laptop with no
 * provider account and no tunnel — which is the difference between a judge
 * seeing it work and a judge reading about it working.
 *
 * It does not shortcut anything: the payload goes through the same signature
 * check, the same idempotency claim and the same order machine as a real
 * Paystack delivery. The only thing that is fake is the money.
 *
 * Disabled unless NGN_RAIL is sandbox.
 */
export async function POST(req: Request) {
  if ((process.env.NGN_RAIL ?? 'sandbox') !== 'sandbox') {
    return NextResponse.json({ error: 'Demo credits are sandbox-only' }, { status: 403 });
  }

  const { orderId } = (await req.json()) as { orderId?: string };
  const order = orderId ? await getOrder(orderId) : null;
  if (!order?.virtualAccount) {
    return NextResponse.json({ error: 'No order awaiting payment' }, { status: 404 });
  }

  const body = JSON.stringify({
    event: 'charge.success',
    data: {
      id: randomUUID(),
      accountNumber: order.virtualAccount.accountNumber,
      amount: order.ngnAmount,
      senderName: 'DEMO SENDER',
      senderAccount: '0123456789',
      senderBank: 'GTBank',
    },
  });

  const res = await fetch(new URL('/api/webhooks/ngn', req.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ona-signature': signSandboxWebhook(body) },
    body,
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
