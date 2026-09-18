/**
 * Runs the Nigerian leg end to end against a running dev server: creates an
 * order, pays it through the sandbox rail, and prints where the money
 * landed. The whole NGN -> USDC leg from one command — the Bolivian leg
 * still needs a signed-in browser, since createOffRamp runs from the
 * sender's own session by design (see lib/pollar/ramp.ts).
 *
 * Usage:
 *   npm run dev                        # in one terminal
 *   npm run seed:demo -- <G-address>   # in another — sign in once at
 *                                      # localhost:3000 to get an address
 */

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `${path} failed with ${res.status}`);
  return data as T;
}

async function main() {
  const senderWallet = process.argv[2];
  if (!senderWallet) {
    console.error('Usage: npm run seed:demo -- <G-address>');
    console.error(`Sign in once at ${BASE} to get one.`);
    process.exit(1);
  }

  const order = await postJson<{ id: string; reference: string; virtualAccount: { accountNumber: string; bankName: string } }>(
    '/api/orders',
    { ngnAmount: 150_000, senderWallet, senderName: 'Demo Sender', senderEmail: 'demo@ona.example' },
  );
  console.log(`Order ${order.reference} — pay ${order.virtualAccount.accountNumber} (${order.virtualAccount.bankName})`);

  console.log('Firing the sandbox credit…');
  await postJson('/api/demo/credit', { orderId: order.id });

  // Settlement runs out of band from the webhook ack — give it a moment.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/api/orders/${order.id}`);
    const current = await res.json();
    console.log(`  ${current.state}`);
    if (current.settlementHash) {
      console.log(`\nSettled on Stellar: ${current.settlementHash}`);
      console.log(`Receipt: ${BASE}/receipt/${order.id}`);
      return;
    }
    if (['FAILED', 'REFUNDED'].includes(current.state)) {
      console.error(`\nOrder did not settle: ${current.failure?.detail ?? current.state}`);
      process.exit(1);
    }
  }

  console.log(`\nStill in flight — check ${BASE}/receipt/${order.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
