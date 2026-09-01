/**
 * Wallet V5R1 (W5) contract helpers for the RN-safe builders — the same shape
 * as `walletV4R2.ts`. The code cell, data layout and address live in
 * `@vultisig/core-chain/chains/ton/walletV5R1`, which is `@ton/core` only, so
 * the keysign resolvers and this builder derive the identical account.
 */
import type { StateInit } from '@ton/core'
import { Address, contractAddress } from '@ton/core'
import { buildTonV5R1StateInit, tonV5R1WalletId } from '@vultisig/core-chain/chains/ton/walletV5R1'

import type { TonV4R2Wallet } from './walletV4R2'

/** W5R1 wallet id on mainnet; WalletCore hardcodes it for `WALLET_V5_R1`, so it is the only id with a parity proof. */
export const TON_V5R1_WALLET_ID = tonV5R1WalletId

/** Same view as a V4R2 wallet; the contract differs, the shape does not. */
export type TonV5R1Wallet = TonV4R2Wallet

/**
 * Construct a W5R1 wallet view (address + StateInit) for the given Ed25519
 * public key. Matches WalletCore's `WalletV5R1::with_public_key` byte for byte.
 */
export function buildV5R1Wallet(opts: {
  publicKeyEd25519: Uint8Array
  workchain?: number
  walletId?: number
}): TonV5R1Wallet {
  const workchain = opts.workchain ?? 0
  const walletId = opts.walletId ?? TON_V5R1_WALLET_ID
  const init: StateInit = buildTonV5R1StateInit({ publicKey: opts.publicKeyEd25519, walletId })
  const address: Address = contractAddress(workchain, init)
  return {
    address,
    init,
    addressString: (o = {}) => address.toString({ bounceable: o.bounceable ?? false, testOnly: o.testOnly ?? false }),
    walletId,
  }
}
