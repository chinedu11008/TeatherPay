import type { NgnRail } from './rail';
import { sandboxRail } from './sandbox';
import { paystackRail } from './paystack';

/**
 * Which rail is live is an env var, never a code branch at the call site.
 * Defaults to sandbox so a fresh clone runs end to end with no accounts.
 */
export function ngnRail(): NgnRail {
  switch (process.env.NGN_RAIL) {
    case 'paystack':
      return paystackRail;
    case 'sandbox':
    default:
      return sandboxRail;
  }
}

export * from './rail';
export { signSandboxWebhook } from './sandbox';
