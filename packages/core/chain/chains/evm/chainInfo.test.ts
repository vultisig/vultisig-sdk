import { EvmChain } from '@vultisig/core-chain/Chain'
import { evmChainInfo } from '@vultisig/core-chain/chains/evm/chainInfo'
import { describe, expect, it } from 'vitest'

const canonicalMulticall3 = '0xca11bde05977b3631167028862be2a173976ca11'

describe('evmChainInfo', () => {
  it('keeps Multicall3 on Robinhood so balance discovery batches its token catalog', () => {
    const { contracts } = evmChainInfo[EvmChain.Robinhood]

    expect(contracts?.multicall3?.address.toLowerCase()).toBe(canonicalMulticall3)
  })
})
