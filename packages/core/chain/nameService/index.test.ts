import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ens: vi.fn(),
  thorname: vi.fn(),
  mayaname: vi.fn(),
}))

vi.mock('./resolvers/ens', () => ({
  ensResolver: { isChainSupported: (chain: Chain) => chain === Chain.Ethereum, resolve: mocks.ens },
}))
vi.mock('./resolvers/thorname', () => ({
  thornameResolver: { isChainSupported: (chain: Chain) => chain !== Chain.Polygon, resolve: mocks.thorname },
}))
vi.mock('./resolvers/mayaname', () => ({
  mayanameResolver: { isChainSupported: () => true, resolve: mocks.mayaname },
}))

import { isNameServiceChain, resolveNameServiceName } from './index'

describe('resolveNameServiceName', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
  })

  it('routes the name to its service', async () => {
    mocks.thorname.mockResolvedValue({ kind: 'resolved', address: 'bc1qalias' })

    await expect(
      resolveNameServiceName({ service: 'thorname', name: 'vi.thor', chain: Chain.Bitcoin })
    ).resolves.toEqual({ kind: 'resolved', address: 'bc1qalias' })
    expect(mocks.thorname).toHaveBeenCalledWith({ name: 'vi.thor', chain: Chain.Bitcoin })
    expect(mocks.ens).not.toHaveBeenCalled()
    expect(mocks.mayaname).not.toHaveBeenCalled()
  })

  it('answers a chain the service cannot hold without a lookup', async () => {
    await expect(resolveNameServiceName({ service: 'ens', name: 'vitalik.eth', chain: Chain.Base })).resolves.toEqual({
      kind: 'noAddressForChain',
    })
    expect(mocks.ens).not.toHaveBeenCalled()
  })

  it('lets a lookup failure through', async () => {
    mocks.mayaname.mockRejectedValue(new Error('MAYANode unavailable'))

    await expect(
      resolveNameServiceName({ service: 'mayaname', name: 'eld.maya', chain: Chain.MayaChain })
    ).rejects.toThrow('MAYANode unavailable')
  })
})

describe('isNameServiceChain', () => {
  it("asks the service's resolver", () => {
    expect(isNameServiceChain({ service: 'thorname', chain: Chain.Bitcoin })).toBe(true)
    expect(isNameServiceChain({ service: 'thorname', chain: Chain.Polygon })).toBe(false)
  })
})
