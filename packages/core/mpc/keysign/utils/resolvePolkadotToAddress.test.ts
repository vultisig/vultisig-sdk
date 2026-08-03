import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsValidAddress, mockGetKeysignCoin } = vi.hoisted(() => ({
  mockIsValidAddress: vi.fn(),
  mockGetKeysignCoin: vi.fn(),
}))

vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({ isValidAddress: mockIsValidAddress }))
vi.mock('./getKeysignCoin', () => ({ getKeysignCoin: mockGetKeysignCoin }))

import { resolvePolkadotToAddress } from './resolvePolkadotToAddress'

const walletCore = {} as never
const call = (toAddress: string) => resolvePolkadotToAddress({ keysignPayload: { toAddress } as never, walletCore })

describe('resolvePolkadotToAddress', () => {
  beforeEach(() => {
    mockGetKeysignCoin.mockReturnValue({ chain: 'Polkadot', address: '1SENDERownAddress' })
  })

  it('returns the destination when it is a valid address', () => {
    mockIsValidAddress.mockReturnValue(true)
    expect(call('1RECIPIENTvalidAddress')).toBe('1RECIPIENTvalidAddress')
  })

  it('throws (never falls back to the sender) when toAddress is empty', () => {
    mockIsValidAddress.mockReturnValue(true)
    expect(() => call('')).toThrow(/refusing to fall back/)
  })

  it('throws (never falls back to the sender) when toAddress is invalid', () => {
    mockIsValidAddress.mockReturnValue(false)
    expect(() => call('0xdeadbeef')).toThrow(/refusing to fall back/)
  })
})
