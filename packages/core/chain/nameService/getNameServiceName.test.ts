import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getBareNameServiceName, getNameServiceName } from './getNameServiceName'

describe('getNameServiceName', () => {
  it.each([
    ['vitalik.eth', 'ens', 'vitalik.eth'],
    ['pay.vitalik.eth', 'ens', 'pay.vitalik.eth'],
    ['vi.thor', 'thorname', 'vi.thor'],
    ['  My-Name_1+.THOR ', 'thorname', 'my-name_1+.thor'],
    ['eld.maya', 'mayaname', 'eld.maya'],
  ])('reads %j as a %s name', (input, service, name) => {
    expect(getNameServiceName(input)).toEqual({ service, name })
  })

  it.each([
    ['', 'empty input'],
    ['.thor', 'a suffix without a name'],
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'a raw address'],
    ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'a raw address'],
    ['vi.thorchain', 'a longer suffix'],
    ['my.name.thor', 'a dotted THORName'],
    ['a'.repeat(31) + '.thor', 'a THORName over 30 characters'],
    ['bad name.maya', 'a MAYAName with a space'],
    ['vitalik .eth', 'an ENS name with a space'],
  ])('ignores %j (%s)', input => {
    expect(getNameServiceName(input)).toBeNull()
  })
})

describe('getBareNameServiceName', () => {
  it('trims and lowercases the name and adds its suffix', () => {
    expect(getBareNameServiceName({ input: ' Vi ', chain: Chain.THORChain })).toEqual({
      service: 'thorname',
      name: 'vi.thor',
    })
  })

  it.each<[Chain, string, string]>([
    [Chain.THORChain, 'thorname', 'vi.thor'],
    [Chain.MayaChain, 'mayaname', 'vi.maya'],
    [Chain.Ethereum, 'ens', 'vi.eth'],
  ])('reads a bare name on %s as a %s, %s', (chain, service, name) => {
    expect(getBareNameServiceName({ input: 'vi', chain })).toEqual({ service, name })
  })

  it.each<[string, Chain, string]>([
    ['vi', Chain.Bitcoin, 'a chain without a name service of its own'],
    ['vi', Chain.Arbitrum, 'an EVM chain other than Ethereum'],
    ['vi', Chain.Dash, 'a chain Maya trades'],
    ['vi', Chain.Near, 'NEAR, whose account IDs are names of their own'],
    ['vi.thor', Chain.THORChain, 'a suffixed name'],
    ['thor1' + 'q'.repeat(38), Chain.THORChain, 'a THORChain address'],
    ['', Chain.Ethereum, 'empty input'],
  ])('ignores %j on %s (%s)', (input, chain) => {
    expect(getBareNameServiceName({ input, chain })).toBeNull()
  })
})
