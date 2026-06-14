import { afterEach, describe, expect, it } from 'vitest'

import { Chain, CosmosChain, EvmChain, UtxoChain } from '../../Chain'
import { cosmosRpcUrl } from '../cosmos/cosmosRpcUrl'
import { getCosmosRpcUrl } from '../cosmos/getCosmosRpcUrl'
import { getEvmRpcUrl } from '../evm/chainInfo'
import {
  clearCustomRpcOverride,
  getCustomRpcOverride,
  setCustomRpcOverride,
  setCustomRpcOverrides,
} from './customRpcOverrides'
import { customRpcSupportedChains, isCustomRpcSupported } from './customRpcSupportedChains'

const ethDefaultRpcUrl = getEvmRpcUrl(EvmChain.Ethereum)

afterEach(() => {
  // Reset the in-memory mirror so each test starts from defaults.
  setCustomRpcOverrides({})
})

describe('custom RPC override registry', () => {
  it('returns the default EVM RPC URL when no override is set', () => {
    expect(getEvmRpcUrl(EvmChain.Ethereum)).toBe(ethDefaultRpcUrl)
  })

  it('resolves the override EVM RPC URL when set, and clears back to default', () => {
    setCustomRpcOverride(EvmChain.Ethereum, 'https://my-node.example/')
    expect(getEvmRpcUrl(EvmChain.Ethereum)).toBe('https://my-node.example/')

    clearCustomRpcOverride(EvmChain.Ethereum)
    expect(getEvmRpcUrl(EvmChain.Ethereum)).toBe(ethDefaultRpcUrl)
  })

  it('resolves the override Cosmos LCD URL when set, default otherwise', () => {
    expect(getCosmosRpcUrl(CosmosChain.Cosmos)).toBe(cosmosRpcUrl[CosmosChain.Cosmos])

    setCustomRpcOverride(CosmosChain.Cosmos, 'https://my-cosmos.example')
    expect(getCosmosRpcUrl(CosmosChain.Cosmos)).toBe('https://my-cosmos.example')
  })

  it('keeps overrides isolated per chain', () => {
    setCustomRpcOverride(EvmChain.Ethereum, 'https://eth-node.example/')
    expect(getCustomRpcOverride(EvmChain.Ethereum)).toBe('https://eth-node.example/')
    expect(getCustomRpcOverride(EvmChain.Avalanche)).toBeUndefined()
  })

  it('replaces the whole map on hydrate, dropping stale entries', () => {
    setCustomRpcOverride(EvmChain.Ethereum, 'https://eth-node.example/')
    setCustomRpcOverrides({ [EvmChain.Base]: 'https://base-node.example/' })

    expect(getCustomRpcOverride(EvmChain.Ethereum)).toBeUndefined()
    expect(getCustomRpcOverride(EvmChain.Base)).toBe('https://base-node.example/')
  })
})

describe('custom RPC supported chains', () => {
  it('includes every EVM chain and the IBC-enabled Cosmos chains', () => {
    for (const chain of Object.values(EvmChain)) {
      expect(customRpcSupportedChains).toContain(chain)
      expect(isCustomRpcSupported(chain)).toBe(true)
    }

    expect(customRpcSupportedChains).toContain(CosmosChain.Osmosis)
  })

  it('excludes vault-based Cosmos, UTXO, and QBTC chains', () => {
    expect(isCustomRpcSupported(Chain.THORChain)).toBe(false)
    expect(isCustomRpcSupported(Chain.MayaChain)).toBe(false)
    expect(isCustomRpcSupported(UtxoChain.Bitcoin)).toBe(false)
    expect(isCustomRpcSupported(Chain.QBTC)).toBe(false)
  })
})
