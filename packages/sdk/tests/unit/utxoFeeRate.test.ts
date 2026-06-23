import { UtxoChain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { utxoFeeRate } from '@/tools/gas'

type InboundAddress = { chain: string; gas_rate: string; halted: boolean }

function mockInbounds(entries: InboundAddress[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => entries,
    text: async () => JSON.stringify(entries),
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('utxoFeeRate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the published sat/vB rate for a healthy chain', async () => {
    mockInbounds([{ chain: 'BTC', gas_rate: '7', halted: false }])
    const result = await utxoFeeRate(UtxoChain.Bitcoin)
    expect(result).toEqual({ chain: 'Bitcoin', feeRate: 7, feeRateUnit: 'sat/vB' })
  })

  it('hits the THORChain inbound source for Bitcoin', async () => {
    const fetchMock = mockInbounds([{ chain: 'BTC', gas_rate: '7', halted: false }])
    await utxoFeeRate(UtxoChain.Bitcoin)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://thornode.thorchain.network/thorchain/inbound_addresses',
      expect.anything()
    )
  })

  it('hits the MayaChain inbound source for Dash (not on THORChain)', async () => {
    const fetchMock = mockInbounds([{ chain: 'DASH', gas_rate: '12', halted: false }])
    const result = await utxoFeeRate(UtxoChain.Dash)
    expect(result).toEqual({ chain: 'Dash', feeRate: 12, feeRateUnit: 'sat/vB' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mayanode.mayachain.info/mayachain/inbound_addresses',
      expect.anything()
    )
  })

  it('throws when the chain is halted (never yields a zero-fee envelope)', async () => {
    mockInbounds([{ chain: 'BTC', gas_rate: '7', halted: true }])
    await expect(utxoFeeRate(UtxoChain.Bitcoin)).rejects.toThrow(/halted/)
  })

  it('throws on a non-positive gas_rate', async () => {
    mockInbounds([{ chain: 'BTC', gas_rate: '0', halted: false }])
    await expect(utxoFeeRate(UtxoChain.Bitcoin)).rejects.toThrow(/non-positive/)
  })

  it('throws when the inbound source omits the chain entry', async () => {
    mockInbounds([{ chain: 'ETH', gas_rate: '1', halted: false }])
    await expect(utxoFeeRate(UtxoChain.Bitcoin)).rejects.toThrow(/No fee rate found/)
  })
})
