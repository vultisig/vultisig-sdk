import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEnsAddress = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getEnsAddress }),
}))

import { ensResolver } from './ens'

describe('ensResolver', () => {
  beforeEach(() => {
    getEnsAddress.mockReset()
  })

  it('returns the checksummed address', async () => {
    getEnsAddress.mockResolvedValue('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')

    await expect(ensResolver.resolve({ name: 'vitalik.eth', chain: Chain.Ethereum })).resolves.toEqual({
      kind: 'resolved',
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    })
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'vitalik.eth' })
  })

  it('resolves a subdomain like any other ENS name', async () => {
    getEnsAddress.mockResolvedValue('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')

    await expect(ensResolver.resolve({ name: 'pay.vitalik.eth', chain: Chain.Ethereum })).resolves.toMatchObject({
      kind: 'resolved',
    })
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'pay.vitalik.eth' })
  })

  it('reports a name with no address as not found', async () => {
    getEnsAddress.mockResolvedValue(null)

    await expect(ensResolver.resolve({ name: 'unregistered.eth', chain: Chain.Ethereum })).resolves.toEqual({
      kind: 'notFound',
    })
  })

  it('reports a name ENS cannot hold as not found without a lookup', async () => {
    await expect(ensResolver.resolve({ name: 'bad\u0000name.eth', chain: Chain.Ethereum })).resolves.toEqual({
      kind: 'notFound',
    })
    expect(getEnsAddress).not.toHaveBeenCalled()
  })

  it('holds addresses only on Ethereum', () => {
    expect(ensResolver.isChainSupported(Chain.Ethereum)).toBe(true)
    expect(ensResolver.isChainSupported(Chain.Arbitrum)).toBe(false)
  })
})
