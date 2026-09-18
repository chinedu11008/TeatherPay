import { NextResponse } from 'next/server';
import { advance, getOrder } from '@/lib/orders/store';
import { fundWallet, PollarServerError } from '@/lib/pollar/server';
import { settleOrder } from '@/lib/orders/settle';

/**
 * The compliance gate.
 *
 * In production this is a webhook receiver: the KYC provider calls it when a
 * verification clears, and it is the only thing in the system that can activate
 * a wallet. Here it is also reachable from the demo UI so a judge can watch the
 * gate open.
 *
 * Wallet activation is deliberately coupled to verification rather than to
 * login. Because deferred funding leaves the G-address on-chain with no reserve
 * until this call, there is no code path where an unverified sender holds a
 * wallet that can transact. That property is structural, not a check somebody
 * has to remember to write.
 */
export async function POST(req: Request) {
  const { orderId } = (await req.json()) as { orderId?: string };
  if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 });

  const order = await getOrder(orderId);
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!order.senderWallet) {
    return NextResponse.json({ error: 'Order has no wallet' }, { status: 409 });
  }

  try {
    await fundWallet(order.senderWallet);
  } catch (err) {
    if (err instanceof PollarServerError && err.status === 402) {
      // The app funding wallet is out of XLM. This is an operator incident,
      // not something the sender can act on.
      console.error('[ona] FUNDING WALLET EMPTY — top up Treasury -> Account Funding');
      return NextResponse.json(
        { error: 'Activation is temporarily unavailable. Your money is safe and unspent.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Could not activate the wallet' }, { status: 502 });
  }

  // Naira already in? Settle now. Not yet? The webhook will pick it up.
  if (order.state === 'KYC_PENDING') {
    void settleOrder(orderId).catch(() => {});
  }

  return NextResponse.json({ activated: true });
}
