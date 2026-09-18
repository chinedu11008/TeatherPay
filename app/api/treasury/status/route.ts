import { NextResponse } from 'next/server';
import { treasuryStatus } from '@/lib/treasury/stellar';
import { SETTLEMENT_LOW_WATER } from '@/lib/treasury/float';

/**
 * The settlement treasury's public state: address, balance, whether it's
 * running low. A Stellar public key is meant to be public — this never
 * touches the secret seed.
 *
 * Used by the operator page for polling after a top-up, and by
 * OperatorFloat.tsx to know where to send a top-up.
 */
export async function GET() {
  const status = await treasuryStatus();
  if (!status.configured) {
    return NextResponse.json({ configured: false, reason: status.reason });
  }
  return NextResponse.json({
    configured: true,
    address: status.address,
    balance: status.balance,
    explorerUrl: status.explorerUrl,
    usdcIssuer: process.env.USDC_ISSUER,
    lowWater: SETTLEMENT_LOW_WATER,
    low: Number(status.balance) < SETTLEMENT_LOW_WATER,
  });
}
