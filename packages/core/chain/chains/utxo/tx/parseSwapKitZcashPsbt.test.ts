import { readFileSync } from 'node:fs'

import { sha256 } from '@noble/hashes/sha2.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { p2pkhScriptForAddress } from './p2pkhScriptForAddress'
import { parseSwapKitZcashPsbt, verifySwapKitZcashPrevouts } from './parseSwapKitZcashPsbt'

const fixture = JSON.parse(readFileSync(new URL('./swapkit-zec-sapling.fixture.json', import.meta.url), 'utf8')) as {
  sourceAddress: string
  targetAddress: string
  tx: string
}
const bytes = Buffer.from(fixture.tx, 'base64')

afterEach(() => vi.unstubAllGlobals())

describe('SwapKit Zcash Sapling PSBT parser', () => {
  it('reads the captured provider payload without treating its Zcash header as Bitcoin segwit', () => {
    const tx = parseSwapKitZcashPsbt(bytes)
    expect(tx.inputs).toHaveLength(1)
    expect(tx.outputs).toHaveLength(2)
    expect(tx.locktime).toBe(0)
    expect(tx.inputs[0].scriptPubKey.equals(p2pkhScriptForAddress(Chain.Zcash, fixture.sourceAddress))).toBe(true)
    // The public fixture anonymizes the target address independently of its PSBT output.
    expect(tx.outputs[0].scriptPubKey.equals(p2pkhScriptForAddress(Chain.Zcash, fixture.targetAddress))).toBe(false)
  })

  it('rejects an unsupported consensus framing before signing', () => {
    const altered = Buffer.from(bytes)
    // The unsigned Sapling transaction begins immediately after the PSBT global key and value length.
    const marker = Buffer.from('0400008085202f89', 'hex')
    const offset = altered.indexOf(marker)
    expect(offset).toBeGreaterThan(0)
    altered[offset] = 5
    expect(() => parseSwapKitZcashPsbt(altered)).toThrow('transparent Sapling v4')
  })

  it('rejects a witness UTXO amount that differs from the full previous transaction', async () => {
    const tx = parseSwapKitZcashPsbt(bytes)
    const input = tx.inputs[0]
    const wrongAmount = Buffer.alloc(8)
    wrongAmount.writeBigUInt64LE(input.amount + 1n)
    const raw = Buffer.concat([
      Buffer.from('0400008085202f8901', 'hex'),
      Buffer.alloc(32),
      Buffer.from('ffffffff00ffffffff01', 'hex'),
      wrongAmount,
      Buffer.from([input.scriptPubKey.length]),
      input.scriptPubKey,
      Buffer.alloc(16),
      Buffer.from([0, 0, 0]),
    ])
    const txid = Buffer.from(sha256(sha256(raw)))
      .reverse()
      .toString('hex')
    input.hash = Buffer.from(txid, 'hex').reverse()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            txid,
            hex: raw.toString('hex'),
            in_active_chain: true,
          },
        }),
      })
    )
    await expect(verifySwapKitZcashPrevouts(tx)).rejects.toThrow('does not match its full previous-transaction prevout')
  })
})
