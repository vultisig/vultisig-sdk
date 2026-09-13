import bs58check from 'bs58check'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { estimateTrc20Energy } from '../../../src/chains/tron/rpc'
import {
  buildTrc20CallData,
  buildTrc20TransferTx,
  buildTronSendTx,
  tronAddressToBytes,
} from '../../../src/chains/tron/tx'

const evmBytes = Uint8Array.from({ length: 20 }, (_, i) => i + 1)
const evmHex = Array.from(evmBytes, b => b.toString(16).padStart(2, '0')).join('')
const block = {
  refBlockBytes: new Uint8Array([0x40, 0xdf]),
  refBlockHash: new Uint8Array(8).fill(1),
  timestamp: 1_699_999_940_000n,
  expiration: 1_700_000_000_000n,
}
const validAddress = bs58check.encode(Uint8Array.from([0x41, ...evmBytes]))

afterEach(() => vi.unstubAllGlobals())

describe('Tron address validation across transaction and energy APIs', () => {
  it.each([0x41, 0xa0])('preserves prefix %i and matches recipient ABI encoding', async prefix => {
    const payload = Uint8Array.from([prefix, ...evmBytes])
    const address = bs58check.encode(payload)
    expect(tronAddressToBytes(address)).toEqual(payload)
    const opts = { ...block, from: address, to: address, amount: 1n }
    const native = buildTronSendTx(opts)
    const token = buildTrc20TransferTx({ ...opts, tokenAddress: address, feeLimit: 100_000_000n })
    const rawAddress = prefix.toString(16) + evmHex
    expect(native.unsignedRawHex).toContain(`0a15${rawAddress}1215${rawAddress}`)
    expect(token.unsignedRawHex).toContain(`0a15${rawAddress}1215${rawAddress}`)

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ energy_used: 123 })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      estimateTrc20Energy({ from: address, to: address, tokenAddress: address, amount: 1n }, 'https://tron.example')
    ).resolves.toBe(123)
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(url).toBe('https://tron.example/wallet/triggerconstantcontract')
    expect(body.owner_address).toBe(address)
    expect(body.contract_address).toBe(address)
    expect(body.parameter).toBe('0'.repeat(24) + evmHex + '0'.repeat(63) + '1')
    expect(body.parameter).toBe(Buffer.from(buildTrc20CallData(address, 1n).subarray(4)).toString('hex'))
  })

  const invalidAddresses = [
    '',
    '0OIl',
    validAddress.slice(0, -1) + (validAddress.endsWith('1') ? '2' : '1'),
    bs58check.encode(Uint8Array.from([0x42, ...evmBytes])),
    bs58check.encode(new Uint8Array(20).fill(0x41)),
    bs58check.encode(new Uint8Array(22).fill(0xa0)),
  ]
  it.each(invalidAddresses)('rejects malformed address %s before an RPC request', async address => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(() => tronAddressToBytes(address)).toThrow()
    expect(() => buildTrc20CallData(address, 1n)).toThrow()
    for (const field of ['from', 'to'] as const) {
      expect(() =>
        buildTronSendTx({ ...block, from: validAddress, to: validAddress, amount: 1n, [field]: address })
      ).toThrow()
    }
    expect(() =>
      buildTrc20TransferTx({
        ...block,
        from: validAddress,
        to: validAddress,
        tokenAddress: address,
        amount: 1n,
        feeLimit: 100_000_000n,
      })
    ).toThrow()
    await expect(
      estimateTrc20Energy(
        { from: validAddress, to: address, tokenAddress: validAddress, amount: 1n },
        'https://tron.example'
      )
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
