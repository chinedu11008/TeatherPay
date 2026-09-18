/**
 * Order persistence.
 *
 * Backed by a JSON file so the repo runs with `npm install && npm run dev` and
 * nothing else — no database to provision before a judge can see it work.
 * The interface is deliberately the shape you would back with Postgres:
 * swap the two IO functions and nothing above this file changes.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  type Order,
  type OrderState,
  canAdvance,
  OrderTransitionError,
} from './types';

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');

/** Serialises writes. Node is single-threaded but route handlers are not ordered. */
let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Record<string, Order>> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeAll(orders: Record<string, Order>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(orders, null, 2));
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

/** Unambiguous alphabet: no O/0, no I/1. Read aloud over a phone call. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `ONA-${out}`;
}

export async function getOrder(id: string): Promise<Order | null> {
  const all = await readAll();
  return all[id] ?? null;
}

export async function findByVirtualAccount(accountNumber: string): Promise<Order | null> {
  const all = await readAll();
  return (
    Object.values(all).find(
      (o) => o.virtualAccount?.accountNumber === accountNumber && o.state === 'AWAITING_NGN',
    ) ?? null
  );
}

export async function findByReference(reference: string): Promise<Order | null> {
  const all = await readAll();
  return Object.values(all).find((o) => o.reference === reference) ?? null;
}

export async function listOrders(): Promise<Order[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createOrder(order: Order): Promise<Order> {
  return withLock(async () => {
    const all = await readAll();
    all[order.id] = order;
    await writeAll(all);
    return order;
  });
}

/**
 * Advance an order, rejecting illegal transitions and appending an event.
 * `patch` is applied in the same write so state and data never diverge.
 */
export async function advance(
  id: string,
  to: OrderState,
  patch: Partial<Order> = {},
  note?: string,
): Promise<Order> {
  return withLock(async () => {
    const all = await readAll();
    const order = all[id];
    if (!order) throw new Error(`Order ${id} not found`);

    // Re-applying the state we are already in is a no-op, not an error:
    // webhook retries land here constantly.
    if (order.state !== to) {
      if (!canAdvance(order.state, to)) {
        throw new OrderTransitionError(id, order.state, to);
      }
    }

    const next: Order = {
      ...order,
      ...patch,
      state: to,
      events: [
        ...order.events,
        { at: new Date().toISOString(), state: to, note, data: patch as Record<string, unknown> },
      ],
    };

    all[id] = next;
    await writeAll(all);
    return next;
  });
}

/**
 * Idempotency guard for inbound provider webhooks.
 *
 * Nigerian payment providers retry hard — a credit notification can arrive
 * three or four times. Crediting an order twice is the one bug in this system
 * that costs real money, so every handler claims its event id first and
 * does nothing if the claim fails.
 */
export async function claimEvent(orderId: string, eventId: string): Promise<boolean> {
  return withLock(async () => {
    const all = await readAll();
    const order = all[orderId];
    if (!order) return false;
    if (order.appliedEvents.includes(eventId)) return false;

    order.appliedEvents.push(eventId);
    all[orderId] = order;
    await writeAll(all);
    return true;
  });
}
