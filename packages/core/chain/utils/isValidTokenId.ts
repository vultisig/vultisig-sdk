import { isValidStructTag } from '@mysten/sui/utils'
import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import {
  isValidXrplCurrencyCode,
  parseRippleTokenId,
  rippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { attempt } from '@vultisig/lib-utils/attempt'

import { isValidAddress } from './isValidAddress'

type Input = {
  chain: Chain
  id: string
  walletCore: WalletCore
}

/**
 * Validates a custom token identifier for a given chain.
 *
 * For most chains a token is identified by an address (contract/mint), so this
 * delegates to {@link isValidAddress}. SUI tokens are identified by their fully
 * qualified coin type (e.g. `0x2::sui::SUI`), which is a Move struct tag rather
 * than an account address, so it is validated separately. XRPL issued currencies
 * are identified by a composite `currency.issuer` id and validated as such.
 */
export const isValidTokenId = ({ chain, id, walletCore }: Input) => {
  if (chain === Chain.Sui) {
    return isValidStructTag(id.trim())
  }

  if (chain === Chain.Ripple) {
    const parsed = attempt(() => parseRippleTokenId(id.trim()))
    if ('error' in parsed) {
      return false
    }
    const { currency, issuer } = parsed.data

    // Accept either an on-ledger currency code (`USD`, or the 40-char hex form)
    // or a human ticker (`SOLO`, `RLUSD`) — the latter is how tokens are
    // referenced on explorers like xrpscan. `toXrplCurrencyCode` normalises a
    // ticker to its on-ledger code; anything it cannot encode (e.g. a name
    // longer than 20 bytes) is rejected.
    const currencyCode = attempt(() => toXrplCurrencyCode(currency))
    if ('error' in currencyCode) {
      return false
    }

    return isValidXrplCurrencyCode(currencyCode.data) && isValidAddress({ chain, address: issuer, walletCore })
  }

  return isValidAddress({ chain, address: id, walletCore })
}

/**
 * Canonical form of a custom token id, for storage and equality.
 *
 * EVM contract addresses are case-insensitive, so checksum casing is display
 * metadata rather than identity and the canonical form is lowercase.
 *
 * XRPL also needs normalising: a token may be entered by its human ticker
 * (`SOLO.rsoLo…`, as shown on explorers) or by its on-ledger currency code, and
 * both must resolve to the same id so a manually added token dedupes against the
 * same token discovered from the ledger — which always uses the on-ledger code.
 * `rippleTokenId` re-encodes the currency to that canonical form. Other chains
 * remain byte-for-byte case-sensitive.
 */
export const normalizeTokenId = ({ chain, id }: Pick<Input, 'chain' | 'id'>): string => {
  if (getChainKind(chain) === 'evm') {
    return id.toLowerCase()
  }

  if (chain !== Chain.Ripple) {
    return id
  }

  const canonical = attempt(() => rippleTokenId(parseRippleTokenId(id.trim())))
  if ('error' in canonical) {
    return id
  }

  return canonical.data
}
