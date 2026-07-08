import { isValidStructTag } from '@mysten/sui/utils'
import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { parseRippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
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

    return currency.length > 0 && isValidAddress({ chain, address: issuer, walletCore })
  }

  return isValidAddress({ chain, address: id, walletCore })
}
