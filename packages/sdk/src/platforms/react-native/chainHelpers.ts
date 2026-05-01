/**
 * RN-specific typed wrappers around @vultisig/core-chain functions.
 *
 * The core-chain functions expect @trustwallet/wallet-core's WalletCore type,
 * but React Native consumers pass WalletCoreLike from @vultisig/walletcore-native.
 * These wrappers accept WalletCoreLike and cast internally — the runtime objects
 * are fully compatible, only the TypeScript types differ.
 */
import type { WalletCore } from '@trustwallet/wallet-core'
import type { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType as coreGetCoinType } from '@vultisig/core-chain/coin/coinType'
import { deriveAddress as coreDeriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
import { getPublicKey as coreGetPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import type { PublicKeys } from '@vultisig/core-chain/publicKey/PublicKeys'
import { isValidAddress as coreIsValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import type { WalletCoreLike } from '@vultisig/walletcore-native'

/**
 * Reinterpret WalletCoreLike as TrustWallet's WalletCore for core-chain call
 * signatures. The two are structurally compatible at runtime — only type
 * declarations differ, so the cast is purely a type-system bridge.
 */
const toTwWalletCore = (wc: WalletCoreLike): WalletCore => wc as unknown as WalletCore

type GetPublicKeyInput = {
  chain: Chain
  walletCore: WalletCoreLike
  hexChainCode: string
  publicKeys: PublicKeys
  chainPublicKeys?: Partial<Record<Chain, string>>
}

/** Derive the WalletCore public key for a chain. Accepts WalletCoreLike. */
export const getPublicKey = ({ walletCore, ...rest }: GetPublicKeyInput) =>
  coreGetPublicKey({ ...rest, walletCore: toTwWalletCore(walletCore) })

type DeriveAddressInput = {
  chain: Chain
  publicKey: any
  walletCore: WalletCoreLike
}

/** Derive the on-chain address. Accepts WalletCoreLike. */
export const deriveAddress = ({ walletCore, ...rest }: DeriveAddressInput) =>
  coreDeriveAddress({ ...rest, walletCore: toTwWalletCore(walletCore) })

type IsValidAddressInput = {
  chain: Chain
  address: string
  walletCore: WalletCoreLike
}

/** Validate a chain address. Accepts WalletCoreLike. */
export const isValidAddress = ({ walletCore, ...rest }: IsValidAddressInput) =>
  coreIsValidAddress({ ...rest, walletCore: toTwWalletCore(walletCore) })

type GetCoinTypeInput = {
  walletCore: WalletCoreLike
  chain: Chain
}

/** Get the TrustWallet CoinType for a chain. Accepts WalletCoreLike. */
export const getCoinType = ({ walletCore, ...rest }: GetCoinTypeInput) =>
  coreGetCoinType({ ...rest, walletCore: toTwWalletCore(walletCore) })
