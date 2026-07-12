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
})
