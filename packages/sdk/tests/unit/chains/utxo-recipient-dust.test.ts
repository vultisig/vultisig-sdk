import { bech32 } from '@scure/base'
import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { selectUtxoInputs } from '../../../src/chains/utxo/select'
import {
  type BuildUtxoSendOptions,
  buildUtxoSendTx,
  decodeAddressToPubKeyHash,
  estimateUtxoTxFee,
  getUtxoChainSpec,
  type UtxoChainName,
} from '../../../src/chains/utxo/tx'

const hash = new Uint8Array(20).fill(0xaa)
const legacy = (...version: number[]) => bs58check.encode(Uint8Array.from([...version, ...hash]))
const segwit = (prefix: string) => bech32.encode(prefix, [0, ...bech32.toWords(hash)])
const bchP2pkh = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
const bchP2sh = 'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq'

type Recipient = { type: 'p2pkh' | 'p2sh' | 'p2wpkh'; address: string; minimum: bigint }
type ChainFixture = { chain: UtxoChainName; from: string; recipients: Recipient[] }

// Independent expected values from the default node policies cited in tx.ts.
// In particular, LTC legacy/P2SH must not inherit the sender's SegWit floor,
// and BTC SegWit/BCH/DASH/ZEC must not inherit conservative change disposal.
const chains: ChainFixture[] = [
  {
    chain: 'Bitcoin',
    from: segwit('bc'),
    recipients: [
      { type: 'p2pkh', address: legacy(0), minimum: 546n },
      { type: 'p2sh', address: legacy(5), minimum: 540n },
      { type: 'p2wpkh', address: segwit('bc'), minimum: 294n },
    ],
  },
  {
    chain: 'Litecoin',
    from: segwit('ltc'),
    recipients: [
      { type: 'p2pkh', address: legacy(0x30), minimum: 5_460n },
      { type: 'p2sh', address: legacy(0x32), minimum: 5_400n },
      { type: 'p2wpkh', address: segwit('ltc'), minimum: 2_940n },
    ],
  },
  {
    chain: 'Dogecoin',
    from: legacy(0x1e),
    recipients: [
      { type: 'p2pkh', address: legacy(0x1e), minimum: 100_000n },
      { type: 'p2sh', address: legacy(0x16), minimum: 100_000n },
    ],
  },
  {
    chain: 'Bitcoin-Cash',
    from: bchP2pkh,
    recipients: [
      { type: 'p2pkh', address: bchP2pkh, minimum: 546n },
      { type: 'p2sh', address: bchP2sh, minimum: 540n },
    ],
  },
  {
    chain: 'Dash',
    from: legacy(0x4c),
    recipients: [
      { type: 'p2pkh', address: legacy(0x4c), minimum: 546n },
      { type: 'p2sh', address: legacy(0x10), minimum: 540n },
    ],
  },
  {
    chain: 'Zcash',
    from: legacy(0x1c, 0xb8),
    recipients: [
      { type: 'p2pkh', address: legacy(0x1c, 0xb8), minimum: 54n },
      { type: 'p2sh', address: legacy(0x1c, 0xbd), minimum: 54n },
    ],
  },
]

const input = (value: bigint, index = 0) => ({ hash: 'ab'.repeat(32), index, value })
function options(fixture: ChainFixture, recipient: Recipient, amount = recipient.minimum): BuildUtxoSendOptions {
  return {
    chain: fixture.chain,
    fromAddress: fixture.from,
    toAddress: recipient.address,
    amount,
    utxos: [input(100_000_000n)],
    feeRate: 1,
    compressedPubKey: Uint8Array.from([2, ...new Uint8Array(32).fill(0xaa)]),
    zcashBranchId: 0x4dec4df0,
  }
}

function outputs(raw: string, chain: UtxoChainName) {
  const bytes = Buffer.from(raw, 'hex')
  let offset = chain === 'Zcash' ? 8 : 4
  const inputCount = bytes[offset++]!
  offset += inputCount * 41
  const outputCount = bytes[offset++]!
  return Array.from({ length: outputCount }, () => {
    const value = bytes.readBigUInt64LE(offset)
    offset += 8
    const size = bytes[offset++]!
    const script = bytes.subarray(offset, offset + size).toString('hex')
    offset += size
    return { value, script }
  })
}

describe.each(chains)('recipient dust — $chain', fixture => {
  describe.each(fixture.recipients)('$type', recipient => {
    it('rejects below the recipient minimum before funding math or signing preparation', () => {
      const opts = options(fixture, recipient, recipient.minimum - 1n)
      expect(decodeAddressToPubKeyHash(opts.toAddress, opts.chain).type).toBe(recipient.type)
      expect(() => buildUtxoSendTx({ ...opts, utxos: [input(1n)], zcashBranchId: undefined })).toThrow(
        `amount ${opts.amount} is below the ${fixture.chain} ${recipient.type} recipient minimum ${recipient.minimum}`
      )
    })

    it.each([0n, 1n])('preserves the recipient value at minimum + %s', delta => {
      const opts = options(fixture, recipient, recipient.minimum + delta)
      const tx = buildUtxoSendTx(opts)
      expect(outputs(tx.unsignedRawHex, fixture.chain)[0]!.value).toBe(opts.amount)
      expect(tx.signingHashesHex).toHaveLength(1)
      expect(tx.signingHashesHex[0]).toMatch(/^[a-f0-9]{64}$/)
      expect(typeof tx.finalize).toBe('function')
    })

    it('keeps OP_RETURN at zero value and outside recipient dust policy', () => {
      const tx = buildUtxoSendTx({ ...options(fixture, recipient), opReturnData: 'memo' })
      expect(outputs(tx.unsignedRawHex, fixture.chain).at(-1)).toEqual({ value: 0n, script: '6a046d656d6f' })
    })
  })

  const opts = options(fixture, fixture.recipients[0]!)
  it.each([-1n, 0n, 1n])('preserves change disposal at its own threshold + %s', delta => {
    const change = getUtxoChainSpec(fixture.chain).dustLimit + delta
    const fee = estimateUtxoTxFee(fixture.chain, 1, opts.feeRate, undefined, opts.amount)
    const tx = buildUtxoSendTx({ ...opts, utxos: [input(opts.amount + fee + change)] })
    expect(outputs(tx.unsignedRawHex, fixture.chain)).toHaveLength(delta > 0n ? 2 : 1)
  })

  it.each([0n, -1n])('preserves nonpositive validation for %s', amount => {
    expect(() => buildUtxoSendTx({ ...opts, amount, fromAddress: 'invalid' })).toThrow(
      'amount must be greater than zero'
    )
  })

  it('preserves empty-input and unsupported-chain validation', () => {
    expect(() => buildUtxoSendTx({ ...opts, amount: 1n, utxos: [] })).toThrow('no UTXOs provided')
    expect(() => buildUtxoSendTx({ ...opts, chain: 'unsupported' as UtxoChainName })).toThrow('unsupported UTXO chain')
  })

  it('preserves address validation before a dust error', () => {
    expect(() => buildUtxoSendTx({ ...opts, amount: 1n, toAddress: 'invalid' })).toThrow('UTXO address brand mismatch')
    expect(() => buildUtxoSendTx({ ...opts, amount: 1n, fromAddress: fixture.recipients[1]!.address })).toThrow(
      'P2SH spending is not supported'
    )
  })
})

describe('Dogecoin soft-dust fee', () => {
  const fixture = chains.find(({ chain }) => chain === 'Dogecoin')!
  const opts = options(fixture, fixture.recipients[0]!)

  it.each([100_000n, 999_999n, 1_000_000n])('funds the surcharge only below 0.01 DOGE: %s', amount => {
    const fee = estimateUtxoTxFee('Dogecoin', 1, 1, undefined, amount)
    expect(fee).toBe(228_000n + (amount < 1_000_000n ? 1_000_000n : 0n))
    const exact = input(amount + fee)
    const selected = selectUtxoInputs({ ...opts, amount, utxos: [exact] })
    expect(selected.fee).toBe(fee)
    expect(selected.change).toBe(0n)
    const tx = buildUtxoSendTx({ ...opts, amount, utxos: selected.inputs })
    expect(outputs(tx.unsignedRawHex, 'Dogecoin')).toHaveLength(1)
    expect(() => buildUtxoSendTx({ ...opts, amount, utxos: [input(exact.value - 1n)] })).toThrow('insufficient funds')
  })

  it('selects enough inputs for the surcharge and validates send-max consistently', () => {
    const utxos = [input(800_000n), input(700_000n, 1)]
    const selected = selectUtxoInputs({ ...opts, utxos })
    expect(selected.inputs).toHaveLength(2)
    expect(selected.fee).toBe(1_378_000n)
    expect(() => buildUtxoSendTx({ ...opts, utxos: selected.inputs })).not.toThrow()
    expect(selectUtxoInputs({ ...opts, utxos, sendMax: true }).fee).toBe(selected.fee)
    expect(() => selectUtxoInputs({ ...opts, utxos: [utxos[0]!], sendMax: true })).toThrow('insufficient funds')
  })

  it('does not charge a second soft-dust fee for a zero-value memo', () => {
    const fee = estimateUtxoTxFee('Dogecoin', 1, 1, 'memo', opts.amount)
    expect(fee).toBe(1_243_000n)
    const tx = buildUtxoSendTx({ ...opts, opReturnData: 'memo', utxos: [input(opts.amount + fee)] })
    expect(outputs(tx.unsignedRawHex, 'Dogecoin')).toEqual([
      { value: opts.amount, script: '76a914' + 'aa'.repeat(20) + '88ac' },
      { value: 0n, script: '6a046d656d6f' },
    ])
  })
})
