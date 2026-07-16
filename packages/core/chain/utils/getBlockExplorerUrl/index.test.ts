import { Chain } from '@vultisig/core-chain/Chain'
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

  it('builds a Hyperliquid transaction URL under hypurrscan /evm', () => {
    const txHash =
      '0x00b1b8e2c63d7eb2e2928f297d3898f932cb43ad601f06f0b5da0b31b38d53b6'

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
})
