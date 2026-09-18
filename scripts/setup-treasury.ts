/**
 * Generates (or reuses) the settlement treasury keypair, funds it with testnet
 * XLM via Friendbot, and establishes a USDC trustline.
 *
 * Doesn't get you testnet USDC itself — Friendbot only issues XLM. Ask the
 * Pollar team on Telegram for testnet USDC into this address once it prints,
 * or route a small on-ramp through the app.
 *
 * Usage: npm run setup:treasury
 */
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

async function main() {
  const network = process.env.STELLAR_NETWORK ?? 'testnet';
  if (network !== 'testnet') {
    console.error('This script only sets up a testnet treasury. Fund mainnet by hand.');
    process.exit(1);
  }

  const issuer = process.env.USDC_ISSUER;
  if (!issuer) {
    console.error('Set USDC_ISSUER in .env.local first — copy it from Treasury → Tokens & Trustlines.');
    process.exit(1);
  }

  let keypair: Keypair;
  if (process.env.TREASURY_SECRET_SEED) {
    try {
      keypair = Keypair.fromSecret(process.env.TREASURY_SECRET_SEED);
    } catch {
      console.warn('TREASURY_SECRET_SEED in .env.local is not a valid Stellar secret — generating a new one.');
      keypair = Keypair.random();
    }
  } else {
    keypair = Keypair.random();
  }

  console.log(`Treasury address: ${keypair.publicKey()}`);
  if (!process.env.TREASURY_SECRET_SEED) {
    console.log('\nAdd this to .env.local:');
    console.log(`  TREASURY_SECRET_SEED=${keypair.secret()}\n`);
  }

  console.log('Requesting testnet XLM from Friendbot…');
  const funded = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  // Friendbot 400s on an account that already exists — fine, keep going.
  if (!funded.ok && funded.status !== 400) {
    throw new Error(`Friendbot returned ${funded.status}`);
  }

  const server = new Horizon.Server('https://horizon-testnet.stellar.org');
  const account = await server.loadAccount(keypair.publicKey());
  const usdc = new Asset('USDC', issuer);

  const alreadyTrusts = account.balances.some(
    (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === issuer,
  );

  if (alreadyTrusts) {
    console.log('USDC trustline already established.');
  } else {
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: usdc }))
      .setTimeout(60)
      .build();
    tx.sign(keypair);
    await server.submitTransaction(tx);
    console.log('USDC trustline established.');
  }

  console.log('\nNext: get testnet USDC into this account (ask the Pollar team, or on-ramp through the app),');
  console.log('then `npm run dev` and check the balance at /operator.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
