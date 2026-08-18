import { Chain } from '@vultisig/core-chain/Chain'
import { chainRegistry, deriveFromChainRegistry, extendChainRegistry } from '@vultisig/core-chain/chainRegistry'
import { describe, expect, it } from 'vitest'

import { getBlockExplorerUrl } from '.'

describe('getBlockExplorerUrl', () => {
  it('builds a Terra Classic Finder address URL without a duplicate network segment', () => {
    const address = 'terra1luncaddress'

    expect(
      getBlockExplorerUrl({
        chain: Chain.TerraClassic,
        entity: 'address',
        value: address,
      })
    ).toBe(`https://finder.terra.money/classic/address/${address}`)
  })

  it('preserves the Terra Classic transaction URL', () => {
    const txHash = 'B461F79D09447952E068F31C92236121'

    expect(
      getBlockExplorerUrl({
        chain: Chain.TerraClassic,
        entity: 'tx',
        value: txHash,
      })
    ).toBe(`https://finder.terra.money/classic/tx/${txHash}`)
  })

  it('preserves the default address resolver path for other chains', () => {
    const address = '0x1234'

    expect(
      getBlockExplorerUrl({
        chain: Chain.Ethereum,
        entity: 'address',
        value: address,
      })
    ).toBe(`https://etherscan.io/address/${address}`)
  })

  it.each([
    [Chain.Polkadot, 'address', 'account'],
    [Chain.Polkadot, 'tx', 'extrinsic'],
    [Chain.Ripple, 'address', 'account'],
    [Chain.Ripple, 'tx', 'transaction'],
    [Chain.BitcoinCash, 'tx', 'transaction'],
    [Chain.QBTC, 'address', 'account'],
  ] as const)('preserves the %s %s explorer path', (chain, entity, path) => {
    expect(getBlockExplorerUrl({ chain, entity, value: 'value' })).toContain(`/${path}/value`)
  })

  it('preserves the TON address path without an entity segment', () => {
    expect(
      getBlockExplorerUrl({
        chain: Chain.Ton,
        entity: 'address',
        value: 'EQvalue',
      })
    ).toBe('https://tonviewer.com/EQvalue')
  })

  it('preserves the Tron hash route', () => {
    expect(getBlockExplorerUrl({ chain: Chain.Tron, entity: 'tx', value: 'hash' })).toBe(
      'https://tronscan.org/#/transaction/hash'
    )
  })

  it('builds a Hyperliquid transaction URL under hypurrscan /evm', () => {
    const txHash = '0x00b1b8e2c63d7eb2e2928f297d3898f932cb43ad601f06f0b5da0b31b38d53b6'

    expect(
      getBlockExplorerUrl({
        chain: Chain.Hyperliquid,
        entity: 'tx',
        value: txHash,
      })
    ).toBe(`https://hypurrscan.io/evm/tx/${txHash}`)
  })

  it('builds a Hyperliquid address URL under hypurrscan /evm', () => {
    const address = '0x1234'

    expect(
      getBlockExplorerUrl({
        chain: Chain.Hyperliquid,
        entity: 'address',
        value: address,
      })
    ).toBe(`https://hypurrscan.io/evm/address/${address}`)
  })

  it('keeps the explorer descriptor exhaustive with the Chain union', () => {
    expect(Object.keys(chainRegistry).sort()).toEqual(Object.values(Chain).sort())
  })

  it('publishes immutable descriptors', () => {
    expect(Object.isFrozen(chainRegistry)).toBe(true)
    expect(Object.isFrozen(chainRegistry[Chain.Ethereum])).toBe(true)
    expect(Object.isFrozen(chainRegistry[Chain.Ethereum].explorer)).toBe(true)
    expect(Object.isFrozen(chainRegistry[Chain.Ethereum].explorer.paths)).toBe(true)
  })

  it('derives an exhaustive consumer projection from the registry', () => {
    const explorerBaseUrls = deriveFromChainRegistry(({ explorer }) => explorer.baseUrl)

    expect(Object.keys(explorerBaseUrls).sort()).toEqual(Object.values(Chain).sort())
    expect(explorerBaseUrls[Chain.Ethereum]).toBe('https://etherscan.io')
  })

  it('attaches an exhaustive consumer-local extension without changing SDK descriptors', () => {
    const support = deriveFromChainRegistry(({ chain }) => ({
      status: chain === Chain.Ethereum ? ('supported' as const) : ('unsupported' as const),
    }))
    const extended = extendChainRegistry(support)

    expect(extended[Chain.Ethereum].extension.status).toBe('supported')
    expect(extended[Chain.Bitcoin].extension.status).toBe('unsupported')
    expect(extended[Chain.Ethereum].explorer).toBe(chainRegistry[Chain.Ethereum].explorer)
  })

  it('requires every Chain at the consumer extension type boundary', () => {
    const incompleteSupport = {
      [Chain.Bitcoin]: { status: 'supported' as const },
    }
    const compileOnly = () => {
      // @ts-expect-error An extension cannot silently omit the other Chain members.
      extendChainRegistry(incompleteSupport)
    }

    expect(compileOnly).toBeTypeOf('function')
  })

  it('rejects an incomplete extension record at the JavaScript runtime boundary', () => {
    const firstMissingChain = Object.values(Chain).find(chain => chain !== Chain.Bitcoin)

    expect(() =>
      extendChainRegistry({
        [Chain.Bitcoin]: { status: 'supported' },
      } as unknown as Record<Chain, { status: string }>)
    ).toThrow(`Missing chain extension for ${firstMissingChain}`)
  })
})
