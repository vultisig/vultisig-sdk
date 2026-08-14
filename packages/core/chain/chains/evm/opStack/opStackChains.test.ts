import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { isOpStackChain, opStackChains } from './opStackChains'

// Locked to what the `GasPriceOracle` predeploy actually answers on each chain's
// RPC endpoint: it has code on these four and none on any other EVM chain in the
// registry. A chain moving between the two lists is a deliberate act, not a
// refactor, because the wrong answer either under-reserves a max send (omission)
// or reserves against an oracle that isn't there (addition).
const nonOpStackEvmChains = [
  EvmChain.Ethereum,
  EvmChain.Arbitrum,
  EvmChain.Polygon,
  EvmChain.Avalanche,
  EvmChain.BSC,
  EvmChain.CronosChain,
  EvmChain.Zksync,
  EvmChain.Hyperliquid,
  EvmChain.Sei,
  EvmChain.Robinhood,
]

describe('isOpStackChain', () => {
  it.each(opStackChains)('recognises %s', chain => {
    expect(isOpStackChain(chain)).toBe(true)
  })

  it.each(nonOpStackEvmChains)('rejects %s, which has no GasPriceOracle predeploy', chain => {
    expect(isOpStackChain(chain)).toBe(false)
  })

  it('covers every EVM chain in the registry, so a newly added one has to be classified', () => {
    expect([...opStackChains, ...nonOpStackEvmChains].sort()).toEqual(Object.values(EvmChain).sort())
  })

  it('rejects non-EVM chains', () => {
    expect(isOpStackChain(Chain.Bitcoin)).toBe(false)
    expect(isOpStackChain(Chain.Solana)).toBe(false)
  })
})
