import { EvmChain } from '../../../../Chain'
import { getTwChainId } from '../../../../../mpc/keysign/tw/getTwChainId'
import { numberToEvenHex } from '../../../../../../lib/utils/hex/numberToHex'
import { stripHexPrefix } from '../../../../../../lib/utils/hex/stripHexPrefix'
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
