import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'

/** EVM addresses are case-insensitive; other token identifiers must retain their exact case. */
export const getKnownTokenIndexId = (chain: Chain, id: string): string =>
  getChainKind(chain) === 'evm' ? id.toLowerCase() : id
