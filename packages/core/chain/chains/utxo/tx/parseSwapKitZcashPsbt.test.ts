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

  it('rejects duplicate outpoints before previous-transaction lookups or signing', () => {
    const tx = parseSwapKitZcashPsbt(bytes)
    expect(tx.inputs).toHaveLength(1)
    // This fixture has a one-byte global value length and a 41-byte unsigned input.
    expect(bytes.subarray(5, 7).toString('hex')).toBe('0100')
    expect(bytes[7]).toBeLessThan(0xfd)
    const unsigned = bytes.subarray(8, 8 + bytes[7])
    expect(unsigned[8]).toBe(1)
    const duplicate = Buffer.concat([
      unsigned.subarray(0, 8),
      Buffer.from([2]),
      unsigned.subarray(9, 50),
      unsigned.subarray(9, 50),
      unsigned.subarray(50),
    ])
    expect(duplicate.length).toBeLessThan(0xfd)
    const input = tx.inputs[0]
    const amount = Buffer.alloc(8)
    amount.writeBigUInt64LE(input.amount)
    const witness = Buffer.concat([amount, Buffer.from([input.scriptPubKey.length]), input.scriptPubKey])
    const inputMap = Buffer.concat([Buffer.from([1, 1, witness.length]), witness, Buffer.from([0])])
    const altered = Buffer.concat([
      bytes.subarray(0, 7),
      Buffer.from([duplicate.length]),
      duplicate,
      Buffer.from([0]),
      inputMap,
      inputMap,
      Buffer.alloc(tx.outputs.length),
    ])
    expect(() => parseSwapKitZcashPsbt(altered)).toThrow('duplicate outpoint')
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
