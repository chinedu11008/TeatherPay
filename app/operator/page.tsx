import { listOrders } from '@/lib/orders/store';
import { treasuryStatus } from '@/lib/treasury/stellar';
import { formatBob, formatNgn } from '@/lib/corridor/pricing';
import { OrderQueue } from '../components/OrderQueue';
import { OperatorFloat } from '../components/OperatorFloat';

/**
 * The corridor's own instrument panel.
 *
 * Everything a sender needs is on `/` and reads as a single transfer. This
 * page is the opposite view: every transfer at once, and the two pools of
 * money — settlement treasury and reserve float — that make transfers
 * possible. Not meant for a sender to ever see.
 */
export default async function Operator() {
  const [orders, treasury] = await Promise.all([listOrders(), treasuryStatus()]);

  const settled = orders.filter((o) => o.settlementHash);
  const delivered = orders.filter((o) => o.bobAmount && ['BOB_PAID', 'COMPLETE'].includes(o.state));
  const stuck = orders.filter((o) => o.state === 'KYC_PENDING').length;
  const failed = orders.filter((o) => ['FAILED', 'REFUNDED'].includes(o.state)).length;

  const totalNgn = orders.reduce((sum, o) => sum + o.ngnAmount, 0);
  const totalUsdc = settled.reduce((sum, o) => sum + Number(o.usdcAmount), 0);
  const totalBob = delivered.reduce((sum, o) => sum + (o.bobAmount ?? 0), 0);

  return (
    <main style={{ paddingTop: '3rem' }}>
      <h1>Operator</h1>
      <p className="note">Every transfer, and the two pools of money that carry them.</p>

      <section>
        <h2>Corridor, to date</h2>
        <dl>
          <div className="pair">
            <dt>Transfers</dt>
            <dd>{orders.length}</dd>
          </div>
          <div className="pair">
            <dt>Naira received</dt>
            <dd>{formatNgn(totalNgn)}</dd>
          </div>
          <div className="pair">
            <dt>Settled on Stellar</dt>
            <dd>{totalUsdc.toFixed(2)} USDC</dd>
          </div>
          <div className="pair">
            <dt>Delivered in Bolivia</dt>
            <dd>{formatBob(totalBob)}</dd>
          </div>
          {stuck > 0 ? (
            <div className="pair">
              <dt>Awaiting verification</dt>
              <dd style={{ color: 'var(--transit)' }}>{stuck}</dd>
            </div>
          ) : null}
          {failed > 0 ? (
            <div className="pair">
              <dt>Failed or refunded</dt>
              <dd style={{ color: 'var(--lapaz)' }}>{failed}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section>
        <h2>Settlement treasury</h2>
        {treasury.configured ? (
          <dl>
            <div className="pair">
              <dt>Balance</dt>
              <dd style={{ color: Number(treasury.balance) < 250 ? 'var(--lapaz)' : undefined }}>
                {treasury.balance} USDC
              </dd>
            </div>
            <div className="pair">
              <dt>Address</dt>
              <dd>
                <a href={treasury.explorerUrl} target="_blank" rel="noreferrer">
                  {treasury.address.slice(0, 8)}…{treasury.address.slice(-6)}
                </a>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="note">
            Not set up yet. Run <code>npm run setup:treasury</code> to generate and fund a testnet
            treasury, then add <code>TREASURY_SECRET_SEED</code> to <code>.env.local</code>.
          </p>
        )}
      </section>

      <OperatorFloat />

      <section>
        <h2>Transfers</h2>
        <OrderQueue />
      </section>
    </main>
  );
}
