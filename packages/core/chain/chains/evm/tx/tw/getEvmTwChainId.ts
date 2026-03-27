import { EvmChain } from '@vultisig/core-chain/Chain'
import { getTwChainId } from '@vultisig/core-chain/chains/evm/tx/tw/getTwChainId'
import { numberToEvenHex } from '@vultisig/lib-utils/hex/numberToHex'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { WalletCore } from '@trustwallet/wallet-core'

type Input = {
  walletCore: WalletCore
  chain: EvmChain
}

export const getEvmTwChainId = (input: Input) => {
  const chainId = BigInt(getTwChainId(input))

  const evenHex = numberToEvenHex(chainId)
  const hex = stripHexPrefix(evenHex)

  return Buffer.from(hex, 'hex')
}
