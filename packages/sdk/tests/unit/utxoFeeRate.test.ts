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
      'https://gateway.liquify.com/chain/thorchain_api/thorchain/inbound_addresses',
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

  it('rejects a non-integer gas_rate instead of silently truncating', async () => {
    // parseInt('10.5') === 10 / parseInt('1e3', 10) === 1 — a fee primitive
    // must fail closed on malformed input, not emit a quietly-wrong rate.
    for (const bad of ['10.5', '1e3', '15px', ' ', 'abc']) {
      mockInbounds([{ chain: 'BTC', gas_rate: bad, halted: false }])
      await expect(utxoFeeRate(UtxoChain.Bitcoin)).rejects.toThrow(/non-positive/)
    }
  })

  it('rejects Zcash — it uses ZIP-317, not sat/vB (never returns the inflated ZEC gas_rate)', async () => {
    // Maya publishes ZEC gas_rate=127500 (zats / ZIP-317 model, NOT sat/vB).
    // If Zcash were supported, this would yield feeRate: 127500 sat/vB and
    // build a tx burning the whole balance in fees. Must reject outright.
    const fetchMock = mockInbounds([{ chain: 'ZEC', gas_rate: '127500', halted: false }])
    await expect(utxoFeeRate(UtxoChain.Zcash)).rejects.toThrow(/Unsupported UTXO chain.*Zcash/)
    await expect(utxoFeeRate(UtxoChain.Zcash)).rejects.toThrow(/ZIP-317/)
    // and it must not even hit the network for an unsupported chain
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
