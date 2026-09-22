import { getSolanaClient } from './client'

/** Live rent-exempt minimum for a normal, zero-data native SOL wallet. */
export const getSolanaWalletReserve = async (): Promise<bigint> => {
  const reserve = await getSolanaClient().getMinimumBalanceForRentExemption(0)
  // web3.js can return zero on an RPC error; never turn that into an
  // apparently valid MAX quote without a wallet reserve.
  if (!Number.isSafeInteger(reserve) || reserve <= 0) {
    throw new Error('Invalid Solana wallet rent-exempt reserve')
  }
  return BigInt(reserve)
}
