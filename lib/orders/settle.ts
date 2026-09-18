import 'server-only';
import { advance, getOrder } from './store';
import { settleToWallet } from '../treasury/stellar';
import { ngnRail } from '../rails/ngn';

/**
 * Move the corridor onto Stellar.
 *
 * Called once the naira has landed and the tier check has cleared. Runs out of
 * band from the webhook acknowledgement, so a slow ledger never makes a
 * payment provider think its delivery failed.
 *
 * Safe to call twice: SETTLING -> SETTLING is a no-op in the store, and the
 * settlement hash is written only once.
 */
export async function settleOrder(orderId: string): Promise<void> {
  const order = await getOrder(orderId);
  if (!order) return;
  if (order.settlementHash) return; // already on-chain
  if (!order.senderWallet) return;

  await advance(orderId, 'SETTLING', {}, 'Converting to USDC');

  try {
    const { hash } = await settleToWallet({
      destination: order.senderWallet,
      amount: order.usdcAmount,
      reference: order.reference,
    });

    await advance(
      orderId,
      'IN_FLIGHT',
      { settlementHash: hash },
      `${order.usdcAmount} USDC settled on Stellar`,
    );

    // The account number has done its job. Releasing it stops a late credit
    // from ever landing against a closed order.
    if (order.virtualAccount) {
      void ngnRail().releaseVirtualAccount(order.virtualAccount.providerRef).catch(() => {});
    }
  } catch (err) {
    // The sender's naira is with us and the corridor could not deliver. This
    // owes a refund in naira — never a USDC balance they did not ask for.
    await advance(
      orderId,
      'REFUNDED',
      {
        failure: {
          code: 'SETTLEMENT_FAILED',
          detail: err instanceof Error ? err.message : String(err),
        },
      },
      'Settlement failed — refunding in naira',
    );
  }
}
