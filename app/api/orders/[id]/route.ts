import { NextResponse } from 'next/server';
import { getOrder, advance } from '@/lib/orders/store';
import type { Order } from '@/lib/orders/types';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(order);
}

/**
 * The client reports progress on the legs it owns — the off-ramp runs from the
 * sender's own session, so only the sender's browser knows it happened.
 *
 * Whitelisted transitions only. A client cannot advance an order to SETTLING or
 * declare itself paid; those are ours.
 */
const CLIENT_REPORTABLE = ['OFFRAMP_CREATED', 'BOB_PAID', 'COMPLETE'] as const;
type ClientState = (typeof CLIENT_REPORTABLE)[number];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { state: ClientState; patch?: Partial<Order>; note?: string };

  if (!CLIENT_REPORTABLE.includes(body.state)) {
    return NextResponse.json({ error: 'That state is not client-reportable' }, { status: 403 });
  }

  // Only fields the client is the source of truth for.
  const patch: Partial<Order> = {};
  if (body.patch?.rampTxId) patch.rampTxId = body.patch.rampTxId;
  if (body.patch?.rampQuoteId) patch.rampQuoteId = body.patch.rampQuoteId;
  if (body.patch?.rampRail) patch.rampRail = body.patch.rampRail;
  if (body.patch?.bobAmount) patch.bobAmount = body.patch.bobAmount;
  if (body.patch?.beneficiary) patch.beneficiary = body.patch.beneficiary;

  try {
    return NextResponse.json(await advance(id, body.state, patch, body.note));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not update the order' },
      { status: 409 },
    );
  }
}
