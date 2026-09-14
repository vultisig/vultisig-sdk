import { Address } from '@ton/core'
import { PublicKey, WalletCore } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { getTonV5R1Address, tonV5R1WalletId } from '@vultisig/core-chain/chains/ton/walletV5R1'
import { match } from '@vultisig/lib-utils/match'

/**
 * The wallet contracts a Vultisig TON account can live in. The same Ed25519
 * key yields a different address under each, so they are different accounts.
 */
export const tonWalletVersions = ['v4r2', 'v5r1'] as const

export type TonWalletVersion = (typeof tonWalletVersions)[number]

/**
 * The contract every Vultisig TON address has been derived from so far. W5 is
 * an explicit opt-in: switching a key's default would silently move the user
 * to an empty account.
 */
export const defaultTonWalletVersion: TonWalletVersion = 'v4r2'

export { tonV5R1WalletId }

/**
 * How many outgoing messages one external request may carry. V4 is limited by
 * the wallet code; W5 by the 255-entry action list.
 */
export const tonMaxMessagesPerRequest: Record<TonWalletVersion, number> = { v4r2: 4, v5r1: 255 }

type DeriveTonAddressInput = {
  publicKey: PublicKey
  walletCore: WalletCore
  version: TonWalletVersion
}

/**
 * The user-friendly, non-bounceable (`UQ…`) address of this key's wallet
 * under the given contract. V4R2 is WalletCore's own TON derivation; W5 is the
 * hash of the StateInit the contract is deployed from, built with `@ton/core`
 * from the key bytes alone — no WalletCore feature beyond the public key, so it
 * also works on React Native, whose native bridge exposes no `TONWallet`.
 */
export const deriveTonAddress = ({ publicKey, walletCore, version }: DeriveTonAddressInput): string =>
  match(version, {
    v4r2: () => walletCore.CoinTypeExt.deriveAddressFromPublicKey(walletCore.CoinType.ton, publicKey),
    v5r1: () =>
      getTonV5R1Address({ publicKey: publicKey.data() }).toString({
        bounceable: false,
        testOnly: false,
        urlSafe: true,
      }),
  })

type ResolveTonWalletVersionInput = {
  address: string
  publicKey: PublicKey
  walletCore: WalletCore
}

/**
 * Which wallet contract an address is, for this key.
 *
 * The keysign payload carries no wallet-version field, so the sender address
 * is the contract's identity: every co-signer derives both candidate addresses
 * from the shared vault key and matches. An address that is neither is refused
 * rather than assumed V4R2 — signing a V4R2 request for a wallet that is not
 * one would either be rejected on chain or, worse, accepted by a contract we
 * never meant to drive.
 */
export const resolveTonWalletVersion = ({ address, publicKey, walletCore }: ResolveTonWalletVersionInput) => {
  const account = Address.parse(address)

  const version = tonWalletVersions.find(candidate =>
    Address.parse(deriveTonAddress({ publicKey, walletCore, version: candidate })).equals(account)
  )

  if (!version) {
    throw new Error(
      `TON address ${address} is not this key's V4R2 or W5 wallet; refusing to sign for an unknown wallet contract`
    )
  }

  return version
}
