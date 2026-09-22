import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queryUrl: vi.fn() }))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { comment } from '@ton/core'

import { estimateTonGasless, getTonGaslessConfig, isTonGasJetton, sendTonGasless } from './api'

const relay = '0:7ae5056c3fd9406f9bbbe7c7089cd4c40801d9075486cbedb7ce12df119eacf1'
const usdtRaw = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe'
const usdtFriendly = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

describe('getTonGaslessConfig / isTonGasJetton', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the relay address and the accepted jettons from tonapi', async () => {
    mocks.queryUrl.mockResolvedValue({
      relay_address: relay,
      gas_jettons: [{ master_id: usdtRaw }],
    })

    const config = await getTonGaslessConfig()

    expect(mocks.queryUrl).toHaveBeenCalledWith('https://tonapi.io/v2/gasless/config')
    expect(config).toEqual({
      relayAddress: relay,
      gasJettonMasters: [usdtRaw],
    })
    expect(isTonGasJetton(config, usdtFriendly)).toBe(true)
    expect(isTonGasJetton(config, usdtRaw.toUpperCase())).toBe(true)
    expect(isTonGasJetton(config, relay)).toBe(false)
  })
})

describe('estimateTonGasless', () => {
  beforeEach(() => vi.clearAllMocks())

  const message = comment('transfer')

  it('posts the wallet, its key and the messages as hex BOCs, and maps the quote back', async () => {
    mocks.queryUrl.mockResolvedValue({
      protocol_name: 'gasless',
      relay_address: relay,
      commission: '150000',
      from: '0:aa',
      valid_until: 1_800_000_000,
      messages: [
        {
          address: '0:11',
          amount: '80000000',
          payload: comment('a').toBoc().toString('hex'),
        },
        {
          address: '0:11',
          amount: '50000000',
          payload: comment('b').toBoc().toString('base64'),
          stateInit: undefined,
        },
      ],
    })

    const quote = await estimateTonGasless({
      gasJettonMaster: usdtRaw,
      walletAddress: '0:aa',
      walletPublicKeyHex: 'ab'.repeat(32),
      messages: [message],
    })

    const [url, options] = mocks.queryUrl.mock.calls[0]
    expect(url).toBe(`https://tonapi.io/v2/gasless/estimate/${encodeURIComponent(usdtRaw)}`)
    expect(options.body).toEqual({
      wallet_address: '0:aa',
      wallet_public_key: 'ab'.repeat(32),
      messages: [{ boc: message.toBoc().toString('hex') }],
      throw_error_if_not_enough_jettons: false,
      return_emulation: false,
    })

    expect(quote.relayAddress).toBe(relay)
    expect(quote.commission).toBe(150_000n)
    expect(quote.validUntil).toBe(1_800_000_000)
    expect(quote.protocolName).toBe('gasless')
    // Payloads are normalized to base64 whichever encoding the relay used.
    expect(quote.messages).toEqual([
      {
        to: '0:11',
        amount: '80000000',
        payload: comment('a').toBoc().toString('base64'),
        stateInit: undefined,
      },
      {
        to: '0:11',
        amount: '50000000',
        payload: comment('b').toBoc().toString('base64'),
        stateInit: undefined,
      },
    ])
  })

  it('refuses a quote with nothing to sign or a non-numeric commission', async () => {
    mocks.queryUrl.mockResolvedValueOnce({
      relay_address: relay,
      commission: '1',
      valid_until: 1,
      messages: [],
    })
    await expect(
      estimateTonGasless({
        gasJettonMaster: usdtRaw,
        walletAddress: '0:aa',
        walletPublicKeyHex: '',
        messages: [message],
      })
    ).rejects.toThrow(/no messages/)

    mocks.queryUrl.mockResolvedValueOnce({
      relay_address: relay,
      commission: '1.5',
      valid_until: 1,
      messages: [{ address: '0:11', amount: '1' }],
    })
    await expect(
      estimateTonGasless({
        gasJettonMaster: usdtRaw,
        walletAddress: '0:aa',
        walletPublicKeyHex: '',
        messages: [message],
      })
    ).rejects.toThrow(/commission/)
  })
})

describe('sendTonGasless', () => {
  beforeEach(() => vi.clearAllMocks())

  it('posts the signed envelope and returns what the relay reports', async () => {
    mocks.queryUrl.mockResolvedValue({
      protocol_name: 'gasless',
      external: 'abc',
    })

    await expect(sendTonGasless({ boc: 'te6...', walletPublicKeyHex: 'ab'.repeat(32) })).resolves.toEqual({
      protocol_name: 'gasless',
      external: 'abc',
    })
    expect(mocks.queryUrl).toHaveBeenCalledWith('https://tonapi.io/v2/gasless/send', {
      body: { boc: 'te6...', wallet_public_key: 'ab'.repeat(32) },
    })
  })

  it('omits the public key when the caller has none', async () => {
    mocks.queryUrl.mockResolvedValue({ protocol_name: 'gasless' })

    await sendTonGasless({ boc: 'te6...' })

    expect(mocks.queryUrl.mock.calls[0][1]).toEqual({
      body: { boc: 'te6...' },
    })
  })
})
