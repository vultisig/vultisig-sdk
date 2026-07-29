import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getQbtcAccountInfo } from './getQbtcAccountInfo'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

const blockResponse = {
  block: {
    header: {
      height: '12345',
      time: '2026-07-16T00:00:00.000Z',
    },
  },
}

const mockResponses = (accountNumber: string, sequence: string) => {
  vi.mocked(queryUrl)
    .mockResolvedValueOnce({
      account: {
        address: 'qbtc1test',
        account_number: accountNumber,
        sequence,
      },
    } as never)
    .mockResolvedValueOnce(blockResponse as never)
}

describe('getQbtcAccountInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['0000000001', '0000000002'],
    ['4294967296', '4294967297'],
    ['9007199254740993', '9007199254740995'],
    ['18446744073709551615', '18446744073709551615'],
  ])('preserves uint64 account identifiers %s and %s exactly', async (accountNumber, sequence) => {
    mockResponses(accountNumber, sequence)

    const result = await getQbtcAccountInfo({ address: 'qbtc1test' })

    expect(result.accountNumberBigInt).toBe(BigInt(accountNumber))
    expect(result.sequenceBigInt).toBe(BigInt(sequence))
  })

  it('preserves the legacy numeric account fields for existing consumers', async () => {
    mockResponses('7', '3')

    const result = await getQbtcAccountInfo({ address: 'qbtc1test' })

    expect(result.accountNumber).toBe(7)
    expect(result.sequence).toBe(3)
  })

  it.each([
    ['-1', '0'],
    ['1.5', '0'],
    ['18446744073709551616', '0'],
    ['0', '18446744073709551616'],
  ])('rejects invalid uint64 account data %s and %s', async (accountNumber, sequence) => {
    mockResponses(accountNumber, sequence)

    await expect(getQbtcAccountInfo({ address: 'qbtc1test' })).rejects.toThrow(/Invalid QBTC/)
  })

  it('rejects numeric JSON values before they can be rounded', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        account: {
          address: 'qbtc1test',
          account_number: Number('9007199254740993'),
          sequence: 3,
        },
      } as never)
      .mockResolvedValueOnce(blockResponse as never)

    await expect(getQbtcAccountInfo({ address: 'qbtc1test' })).rejects.toThrow(/expected an unsigned integer/)
  })
})
