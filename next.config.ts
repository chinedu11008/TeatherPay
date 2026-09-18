import type { NextConfig } from 'next';

const config: NextConfig = {
  // The Stellar SDK ships node builtins it only uses server-side.
  serverExternalPackages: ['@stellar/stellar-sdk'],
};

export default config;
