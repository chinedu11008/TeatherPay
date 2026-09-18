/**
 * Operator treasury on Stellar.
 *
 * Why this is not a Pollar wallet: Pollar custodies *user* wallets, and that is
 * exactly right for users. Corridor float is the operator's own money and
 * belongs in the operator's own account, under the operator's own key, with its
 * own signing policy. Mixing float into a user wallet would mean the corridor's
 * balance sheet lives behind someone's OAuth session.
 *
 * So: Pollar owns the user side, this file owns the operator side, and the
 * corridor is the payment between them.
 *
 * Server-only. Never import this from a client component.
 */

import 'server-only';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export type Network = 'testnet' | 'mainnet';

function network(): Network {
  return (process.env.STELLAR_NETWORK as Network) ?? 'testnet';
}

function horizonUrl(): string {
  return network() === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

function passphrase(): string {
  return network() === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export function usdc(): Asset {
  const issuer = process.env.USDC_ISSUER;
  if (!issuer) throw new Error('USDC_ISSUER is not set');
  return new Asset('USDC', issuer);
}

function treasuryKeypair(): Keypair {
  const seed = process.env.TREASURY_SECRET_SEED;
  if (!seed) throw new Error('TREASURY_SECRET_SEED is not set');
  return Keypair.fromSecret(seed);
}

export function treasuryAddress(): string {
  return treasuryKeypair().publicKey();
}

export function explorerTxUrl(hash: string): string {
  const net = network();
  return `https://${net === 'mainnet' ? '' : 'testnet.'}stellar.expert/explorer/${net}/tx/${hash}`;
}

export function explorerAccountUrl(address: string): string {
  const net = network();
  return `https://${net === 'mainnet' ? '' : 'testnet.'}stellar.expert/explorer/${net}/account/${address}`;
}

export interface SettlementResult {
  hash: string;
  ledger?: number;
}

/**
 * Send USDC from corridor treasury to the sender's Pollar wallet.
 *
 * The memo carries the order reference. This is what makes a Stellar payment
 * reconcilable against a naira deposit — and it survives us: if Ọ̀nà vanished
 * tomorrow the sender could still prove what moved and when, from a public
 * ledger, with no cooperation from the operator.
 */
export async function settleToWallet(input: {
  destination: string;
  amount: string;
  reference: string;
}): Promise<SettlementResult> {
  const { destination, amount, reference } = input;

  if (!/^G[A-Z2-7]{55}$/.test(destination)) {
    throw new Error(`Not a Stellar public key: ${destination}`);
  }
  // Stellar text memos are 28 bytes. Our references are 10 ASCII chars, but
  // assert rather than let the network reject the built transaction.
  if (Buffer.byteLength(reference, 'utf8') > 28) {
    throw new Error('Reference too long for a text memo');
  }

  const server = new Horizon.Server(horizonUrl());
  const keypair = treasuryKeypair();
  const account = await server.loadAccount(keypair.publicKey());

  // The destination must already trust USDC. Pollar establishes the trustline
  // at wallet activation, so an untrusted destination means the wallet was
  // never funded — a corridor bug, caught here rather than as op_no_trust.
  const dest = await server.loadAccount(destination).catch(() => null);
  if (!dest) {
    throw new Error('Destination account does not exist on-chain — wallet not activated');
  }
  const trusts = dest.balances.some(
    (b) =>
      'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === process.env.USDC_ISSUER,
  );
  if (!trusts) {
    throw new Error('Destination has no USDC trustline — wallet not activated');
  }

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 10), // headroom for surge pricing
    networkPassphrase: passphrase(),
  })
    .addOperation(Operation.payment({ destination, asset: usdc(), amount }))
    .addMemo(Memo.text(reference))
    .setTimeout(60)
    .build();

  tx.sign(keypair);

  const res = await server.submitTransaction(tx);
  return { hash: res.hash, ledger: res.ledger };
}

/** Treasury USDC on hand. Drives the low-float alert on the operator page. */
export async function treasuryUsdcBalance(): Promise<string> {
  const server = new Horizon.Server(horizonUrl());
  const account = await server.loadAccount(treasuryAddress());
  const balance = account.balances.find(
    (b) =>
      'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === process.env.USDC_ISSUER,
  );
  return balance?.balance ?? '0';
}

export type TreasuryStatus =
  | { configured: true; address: string; balance: string; explorerUrl: string }
  | { configured: false; reason: string };

/**
 * Same read as `treasuryUsdcBalance()`, but never throws.
 *
 * The operator page renders before anyone has necessarily run
 * `npm run setup:treasury` — a missing env var or an unfunded account should
 * show a setup prompt, not a 500.
 */
export async function treasuryStatus(): Promise<TreasuryStatus> {
  try {
    const address = treasuryAddress();
    const balance = await treasuryUsdcBalance();
    return { configured: true, address, balance, explorerUrl: explorerAccountUrl(address) };
  } catch (err) {
    return { configured: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Can the corridor honour this order right now?
 *
 * Checked before a virtual account is issued, not after the naira lands.
 * Taking money we cannot settle is the worst failure mode this system has.
 */
export async function canSettle(amount: string): Promise<boolean> {
  try {
    const balance = await treasuryUsdcBalance();
    const has = Number(balance) >= Number(amount);
    if (!has) {
      console.warn(`[treasury] canSettle: have ${balance} USDC, need ${amount}`);
    }
    return has;
  } catch (err) {
    console.error('[treasury] canSettle failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
