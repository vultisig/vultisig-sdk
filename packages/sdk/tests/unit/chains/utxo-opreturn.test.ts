/**
 * OP_RETURN memo output for UTXO THORChain swaps.
 *
 * UTXO (DOGE/BTC/LTC/BCH) THORChain swaps need the swap memo carried on-chain
 * so THORChain can route the vaulted deposit. `buildUtxoSendTx` embeds it as a
 * trailing 0-value OP_RETURN output. The two fund-safety invariants:
 *   1. the memo feeds the sighash outputs digest — every input signature
 *      commits to it (it cannot be stripped/altered post-signing), and
 *   2. the recipient (vault) output keeps the FULL amount — the fee comes from
 *      inputs/change, never by shaving the vault output.
 */
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx } from '../../../src/chains/utxo/tx'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02'
    .concat('aa'.repeat(32))
    .match(/.{2}/g)!
    .map(b => parseInt(b, 16))
)

const DUMMY_SIG =
  '1111111111111111111111111111111111111111111111111111111111111111' +
  '2222222222222222222222222222222222222222222222222222222222222222' +
  '00'

// Representative THORChain swap memo (well under the 80-byte cap).
const THOR_MEMO = '=:DOGE.DOGE:DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L:0/1/0'

const DOGE_OPTS = {
  chain: 'Dogecoin' as const,
  fromAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
  toAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
  amount: 100_000_000n,
  utxos: [
    {
      hash: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f',
      index: 0,
      value: 200_000_000n,
    },
  ],
  feeRate: 1,
  compressedPubKey: COMPRESSED_PUBKEY,
}

const BTC_OPTS = {
  chain: 'Bitcoin' as const,
  fromAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  amount: 10_000n,
  utxos: [
    {
      hash: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f',
      index: 0,
      value: 100_000n,
    },
  ],
  feeRate: 1,
  compressedPubKey: COMPRESSED_PUBKEY,
}

async function outputs(rawTxHex: string) {
  const bjs = await import('bitcoinjs-lib')
  return bjs.Transaction.fromHex(rawTxHex).outs as unknown as { value: bigint; script: Buffer }[]
}

describe('buildUtxoSendTx — OP_RETURN memo', () => {
  it('appends exactly one trailing 0-value OP_RETURN output with the memo bytes (DOGE / legacy sighash)', async () => {
    const withMemo = buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: THOR_MEMO }).finalize([DUMMY_SIG])
    const outs = await outputs(withMemo.rawTxHex)

    // recipient, change, OP_RETURN — the memo output is LAST.
    expect(outs).toHaveLength(3)
    const opReturn = outs[2]!
    expect(opReturn.value).toBe(0n)
    // len 51 <= 75 -> direct push: 0x6a <len> <memo>
    const memoBytes = Buffer.from(THOR_MEMO, 'utf8')
    expect(opReturn.script[0]).toBe(0x6a)
    expect(opReturn.script[1]).toBe(memoBytes.length)
    expect(Buffer.from(opReturn.script.subarray(2)).toString('utf8')).toBe(THOR_MEMO)
  })

  it('preserves the FULL vault amount — the OP_RETURN fee is not shaved off the recipient output', async () => {
    const noMemo = buildUtxoSendTx(DOGE_OPTS).finalize([DUMMY_SIG])
    const withMemo = buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: THOR_MEMO }).finalize([DUMMY_SIG])

    const noMemoOuts = await outputs(noMemo.rawTxHex)
    const withMemoOuts = await outputs(withMemo.rawTxHex)

    // Recipient (index 0) keeps the full amount in both cases.
    expect(noMemoOuts[0]!.value).toBe(DOGE_OPTS.amount)
    expect(withMemoOuts[0]!.value).toBe(DOGE_OPTS.amount)
    // The larger tx (extra OP_RETURN bytes) pays a higher fee — that comes out
    // of change, so change shrinks; the vault output is untouched.
    expect(withMemoOuts[1]!.value).toBeLessThan(noMemoOuts[1]!.value)
  })

  it('commits the memo into the sighash — every input signature changes with the memo (DOGE legacy + BTC BIP143)', () => {
    const dogeNo = buildUtxoSendTx(DOGE_OPTS).signingHashesHex
    const dogeYes = buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: THOR_MEMO }).signingHashesHex
    expect(dogeYes).not.toEqual(dogeNo)

    const btcNo = buildUtxoSendTx(BTC_OPTS).signingHashesHex
    const btcYes = buildUtxoSendTx({ ...BTC_OPTS, opReturnData: THOR_MEMO }).signingHashesHex
    expect(btcYes).not.toEqual(btcNo)
  })

  it('a memo-less call is byte-identical whether opReturnData is omitted or undefined, with no OP_RETURN output', async () => {
    const omitted = buildUtxoSendTx(DOGE_OPTS)
    const explicitUndefined = buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: undefined })

    expect(explicitUndefined.unsignedRawHex).toBe(omitted.unsignedRawHex)
    expect(explicitUndefined.signingHashesHex).toEqual(omitted.signingHashesHex)

    const outs = await outputs(omitted.finalize([DUMMY_SIG]).rawTxHex)
    expect(outs).toHaveLength(2) // recipient + change only
    for (const o of outs) expect(o.script[0]).not.toBe(0x6a)
  })

  it('uses OP_PUSHDATA1 for memos of 76..80 bytes', async () => {
    const memo = 'A'.repeat(78)
    const built = buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: memo }).finalize([DUMMY_SIG])
    const outs = await outputs(built.rawTxHex)
    const script = outs[2]!.script

    // 0x6a OP_PUSHDATA1(0x4c) <len> <memo>
    expect(script[0]).toBe(0x6a)
    expect(script[1]).toBe(0x4c)
    expect(script[2]).toBe(78)
    expect(Buffer.from(script.subarray(3)).toString('utf8')).toBe(memo)
    expect(outs[2]!.value).toBe(0n)
  })

  it('rejects memos larger than the 80-byte standard-relay cap', () => {
    expect(() => buildUtxoSendTx({ ...DOGE_OPTS, opReturnData: 'A'.repeat(81) })).toThrow(/OP_RETURN data too large/)
  })
})
