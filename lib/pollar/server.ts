/**
 * Pollar Server API — secret-key operations.
 *
 * Server-only, always. The secret key must never appear in a client bundle,
 * so this module imports `server-only` to make that a build error rather than
 * a code review.
 */

import 'server-only';

const SERVER_API = 'https://server.api.pollar.xyz';

function secretKey(): string {
  const key = process.env.POLLAR_SECRET_KEY;
  if (!key) throw new Error('POLLAR_SECRET_KEY is not set');
  if (key.startsWith('pub_')) {
    throw new Error('POLLAR_SECRET_KEY holds a publishable key — check your env');
  }
  return key;
}

export class PollarServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Pollar server API ${status}: ${code}`);
    this.name = 'PollarServerError';
  }
}

/**
 * Activate a deferred wallet.
 *
 * This is the corridor's compliance gate. In deferred funding mode the
 * G-address exists on-chain with no XLM reserve and cannot transact; it becomes
 * live only when this is called. Because only our backend can call it, there is
 * no code path where an unverified sender holds a transactable wallet — the
 * property is structural rather than enforced by a check someone can forget.
 *
 * Idempotent: 409 means the wallet is already funded, which is success.
 */
export async function fundWallet(publicKey: string): Promise<{ activated: boolean }> {
  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
    throw new PollarServerError(400, 'INVALID_PUBLIC_KEY');
  }

  const res = await fetch(`${SERVER_API}/v1/wallets/fund`, {
    method: 'POST',
    headers: {
      'x-pollar-api-key': secretKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publicKey }),
  });

  if (res.status === 409) return { activated: true };

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    // 402 means the funding wallet is out of XLM. That is an operator page,
    // not a user error — it should wake somebody up.
    throw new PollarServerError(res.status, body.code ?? 'UNKNOWN');
  }

  return { activated: true };
}
