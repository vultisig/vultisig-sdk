import { Address, Cell } from '@ton/core'
import { PublicKey, WalletCore } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { Buffer } from 'buffer'

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

/**
 * W5R1 wallet id on mainnet, as the contract stores it: the network's global
 * id (-239) XOR'd with the client context `1 | workchain 0 | version 0 |
 * subwallet 0` (0x80000000), giving 0x7FFFFF11. WalletCore hardcodes this
 * value for `WALLET_V5_R1`, so it is the only id that can be co-signed.
 */
export const tonV5R1WalletId = 2147483409

/**
 * How many outgoing messages one external request may carry. V4 is limited by
 * the wallet code; W5 by the 255-entry action list.
 */
export const tonMaxMessagesPerRequest: Record<TonWalletVersion, number> = { v4r2: 4, v5r1: 255 }

const baseWorkchain = 0

type DeriveTonAddressInput = {
  publicKey: PublicKey
  walletCore: WalletCore
  version: TonWalletVersion
}

/**
 * The user-friendly, non-bounceable (`UQ…`) address of this key's wallet
 * under the given contract. V4R2 is WalletCore's own TON derivation; W5 is the
 * hash of the StateInit WalletCore builds for it, which is what the contract
 * will be deployed from on the first send.
 */
export const deriveTonAddress = ({ publicKey, walletCore, version }: DeriveTonAddressInput): string =>
  match(version, {
    v4r2: () => walletCore.CoinTypeExt.deriveAddressFromPublicKey(walletCore.CoinType.ton, publicKey),
    v5r1: () => {
      const stateInitBoc = walletCore.TONWallet.buildV5R1StateInit(publicKey, baseWorkchain, tonV5R1WalletId)
      const [stateInit] = Cell.fromBoc(Buffer.from(stateInitBoc, 'base64'))

      return new Address(baseWorkchain, shouldBePresent(stateInit, 'W5 state init').hash()).toString({
        bounceable: false,
        testOnly: false,
        urlSafe: true,
      })
    },
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
