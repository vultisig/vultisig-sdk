import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, feeMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), feeMock: vi.fn() }))
vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({ getSendFeeEstimate: feeMock }))
vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { getMaxSendAmountFromKeys } from '@/tools/prep/maxSend'
import type { VaultIdentity } from '@/tools/prep/types'

const address = 'TQeC9XCW5LLAaBHRw5P8imYfSt6NX3n7Hq'
const nativeCoin = { ...chainFeeCoin[Chain.Tron], address }
const tokenCoin = { ...nativeCoin, id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', ticker: 'USDT' }
const identity: VaultIdentity = {
  ecdsaPublicKey: 'unused',
  eddsaPublicKey: 'unused',
  hexChainCode: 'unused',
  localPartyId: 'unused',
  libType: 'DKLS',
}

// Exercise the actual max-send -> getCoinBalance -> Tron -> HTTP response
// chain. WalletCore and fee estimation must never be reached after a bad read.
describe('Tron max-send balance failure propagation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    { coin: nativeCoin, responses: [{ Error: 'gateway unavailable' }], message: 'getaccount failed' },
    { coin: nativeCoin, responses: [{ error: 'gateway unavailable' }], message: 'getaccount failed' },
    { coin: tokenCoin, responses: [{ result: '0x' }], message: 'empty contract result' },
    { coin: tokenCoin, responses: [{ error: { code: -32000, message: '0x64' } }], message: 'eth_call failed' },
    {
      coin: tokenCoin,
      responses: [{ result: '0x64' }, { Error: 'gateway unavailable' }],
      message: 'getaccount failed',
    },
  ])('aborts before fee calculation: $message / $responses', async ({ coin, responses, message }) => {
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
    }
    await expect(getMaxSendAmountFromKeys(identity, { coin, receiver: address }, {} as WalletCore)).rejects.toThrow(
      message
    )
    expect(fetchMock).toHaveBeenCalledTimes(responses.length)
    expect(feeMock).not.toHaveBeenCalled()
  })
})
