'use client';

import type { OrderState } from '@/lib/orders/types';
import { RAIL_POSITION as POSITION, STATE_CAPTION as CAPTION, railColour as colourFor } from './order-status';

/**
 * The corridor, as a rail.
 *
 * This is the whole status system. Position along the track is where the money
 * physically is — still in Nigeria, on-chain, or landing in Bolivia — and the
 * colour is the same information a second time, so it reads at a glance and
 * without relying on colour alone.
 *
 * Deliberately not a step counter. A sender does not care that they are on
 * step 4 of 7; they care whether their money has left the country yet.
 */

export function Rail({ state, detail }: { state?: OrderState; detail?: string }) {
  const p = state ? POSITION[state] : 0;
  const colour = colourFor(p);

  return (
    <div className="rail">
      <div className="rail-inner">
        <div className="rail-ends">
          <span>Lagos</span>
          <span>La Paz</span>
        </div>

        <div
          className="rail-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p * 100)}
          aria-label={state ? CAPTION[state] : 'No transfer in progress'}
        >
          <div className="rail-progress" style={{ width: `${p * 100}%` }} />
          <div className="rail-marker" style={{ left: `${p * 100}%`, color: colour }} />
        </div>

        <div className="rail-caption">
          <span style={{ color: state ? colour : 'var(--muted)' }}>
            {state ? CAPTION[state] : 'Naira in, bolivianos out'}
          </span>
          {detail ? <span className="note">{detail}</span> : null}
        </div>
      </div>
    </div>
  );
}
