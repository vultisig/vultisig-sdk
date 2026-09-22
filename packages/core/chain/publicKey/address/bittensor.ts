import { PublicKey, WalletCore } from '@trustwallet/wallet-core/dist/src/wallet-core'

type Input = {
  publicKey: PublicKey
  walletCore: WalletCore
}

const bittensorSs58Prefix = 42

export const deriveBittensorAddress = ({ publicKey, walletCore }: Input) => {
  const address = walletCore.AnyAddress.createSS58WithPublicKey(
    publicKey,
    walletCore.CoinType.polkadot,
    bittensorSs58Prefix
  )
  try {
    const result = address.description()
    if (!walletCore.AnyAddress.isValidSS58(result, walletCore.CoinType.polkadot, bittensorSs58Prefix)) {
      throw new Error('Failed to derive a valid Bittensor address')
    }
    return result
  } finally {
    address.delete()
  }
}
