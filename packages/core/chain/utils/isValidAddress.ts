import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { isAddress } from 'viem'

import { isValidRippleXAddress } from '../chains/ripple/address'
import { decodeBech32 } from './decodeBech32'
import { hasUniformEvmAddressCase, isEvmHexAddress } from './getEvmChecksumMismatchHint'

type Input = {
  chain: Chain
  address: string
  walletCore: WalletCore
}

export const isValidAddress = ({ chain, address, walletCore }: Input) => {
  if (getChainKind(chain) === 'evm') {
    // WalletCore accepts any 0x + 40 hex regardless of letter case, so a
    // one-character typo in a checksummed address used to pass. Uniform-case
    // input carries no checksum and remains valid; mixed-case input must match
    // its EIP-55 checksum.
    if (!isEvmHexAddress(address)) {
      return false
    }

    return hasUniformEvmAddressCase(address) || isAddress(address, { strict: true })
  }

  const coinType = getCoinType({
    walletCore,
    chain,
  })

  if (chain === Chain.Bittensor) {
    return walletCore.AnyAddress.isValidSS58(address, coinType, 42)
  }

  if (chain === Chain.QBTC) {
    try {
      const { prefix } = decodeBech32(address.trim())
      return prefix === 'qbtc'
    } catch {
      return false
    }
  }

  if (chain === Chain.Ripple && /^[XT]/u.test(address.trim())) {
    return isValidRippleXAddress(address)
  }

  if (chain === Chain.MayaChain) {
    // MayaChain is Cosmos-style Bech32. Accept common account + validator address forms.
    const mayaHrps = ['maya', 'mayavaloper', 'mayavalcons', 'mayavaloperpub', 'mayavalconspub'] as const

    const a = address.trim()

    return mayaHrps.some(hrp => walletCore.AnyAddress.isValidBech32(a, coinType, hrp))
  }

  return walletCore.AnyAddress.isValid(address, coinType)
}
