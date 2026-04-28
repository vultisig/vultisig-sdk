import { afterEach, describe, expect, it, vi } from 'vitest'

import { estimateUtxoFee } from '../../../src/chains/utxo/rpc'

// Regression guard for the fee-multiplier bug on the Blockchair code path:
// Math.ceil((base * 25) / 10) is 2.5x baseline, not the documented "+25%".
// That silently charged UTXO senders 2.5x the intended miner fee, siphoning
// fund-safety headroom into over-payment on every Blockchair-backed chain
// (BCH + non-Electrs Bitcoin). Must be ceil(base * 1.25).

describe('estimateUtxoFee — Blockchair baseline + 25% buffer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Bitcoin-Cash: applies a 25% buffer (not 2.5x)', async () => {
    const baseline = 20
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { suggested_transaction_fee_per_byte_sat: baseline } }), { status: 200 })
      )
    )

    const rate = await estimateUtxoFee({
      chain: 'Bitcoin-Cash',
      apiUrl: 'https://api.blockchair.com',
      apiUrlKind: 'blockchair',
    })

    // +25% of 20 = 25, NOT 50 (which would be 2.5x baseline).
    expect(rate).toBe(25)
    expect(rate).toBeLessThan(baseline * 2)
  })

  it('handles non-integer input: ceil(base * 1.25) rounds up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { suggested_transaction_fee_per_byte_sat: 7 } }), { status: 200 })
      )
    )

    const rate = await estimateUtxoFee({
      chain: 'Bitcoin-Cash',
      apiUrl: 'https://api.blockchair.com',
      apiUrlKind: 'blockchair',
    })

    // 7 * 1.25 = 8.75 → ceil → 9
    expect(rate).toBe(9)
  })

  it('returns at least 1 sat/byte even when baseline is 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { suggested_transaction_fee_per_byte_sat: 0 } }), { status: 200 })
      )
    )

    const rate = await estimateUtxoFee({
      chain: 'Bitcoin-Cash',
      apiUrl: 'https://api.blockchair.com',
      apiUrlKind: 'blockchair',
    })

    expect(rate).toBe(1)
  })

  it('Dogecoin: keeps the /10 workaround (Blockchair reports 10x too high)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { suggested_transaction_fee_per_byte_sat: 500_000 } }), { status: 200 })
      )
    )

    const rate = await estimateUtxoFee({
      chain: 'Dogecoin',
      apiUrl: 'https://api.blockchair.com',
      apiUrlKind: 'blockchair',
    })

    // Dogecoin uses floor(base / 10), NOT the +25% buffer path.
    expect(rate).toBe(50_000)
  })
})
