import { NextResponse } from 'next/server';
import { quoteNgnToUsdc } from '@/lib/corridor/pricing';

export async function POST(req: Request) {
  try {
    const { ngnAmount } = (await req.json()) as { ngnAmount?: number };
    if (typeof ngnAmount !== 'number') {
      return NextResponse.json({ error: 'Enter an amount in naira' }, { status: 400 });
    }

    return NextResponse.json(await quoteNgnToUsdc(ngnAmount));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not price this transfer' },
      { status: 400 },
    );
  }
}
