import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { base58CheckTronDecode, getTronCoinBalance } from './tron'

// TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t is the USDT TRC20 contract address.
// Its 20-byte EVM representation is known from the Tron block explorer.
const VALID_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const VALID_ADDRESS_EVM_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'

// TQeC9XCW5LLAaBHRw5P8imYfSt6NX3n7Hq is a known Tron wallet address.
// EVM hex verified via bs58check.decode + subarray(1).
const WALLET_ADDRESS = 'TQeC9XCW5LLAaBHRw5P8imYfSt6NX3n7Hq'
const WALLET_ADDRESS_EVM_HEX = 'a0f14540ca9747b0f238f51bb37dbf866368b502'

// USDT TRC20 contract address (same as VALID_ADDRESS above).
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

// A valid bs58check-encoded 21-byte payload whose first byte is 0x00 (BTC-style),
// not 0x41 (Tron mainnet). Checksum is valid but network prefix is wrong.
// Encoded form of: [0x00, 0xab * 20 bytes] + sha256d-checksum
const NON_TRON_PREFIX_ADDRESS = '1GeiCghwCEqjGS3hDZ1g1SM95h6FCMMzv7'

describe('base58CheckTronDecode', () => {
  it('decodes a valid tron address to the correct 20-byte evm hex', () => {
    const hex = base58CheckTronDecode(VALID_ADDRESS)
    expect(hex).toBe(VALID_ADDRESS_EVM_HEX)
    expect(hex).toHaveLength(40)
  })

  it('throws on a corrupted address (flipped checksum character)', () => {
    // Flip the last character to corrupt the Base58Check checksum.
    // Pre-fix (plain bs58) this silently decoded to a wrong 20-byte value
    // and returned balance 0 for a completely different account.
    // Post-fix (bs58check) this throws immediately.
    const lastChar = VALID_ADDRESS.slice(-1)
    const flippedChar = lastChar === 's' ? 't' : 's'
    const corrupted = VALID_ADDRESS.slice(0, -1) + flippedChar

    expect(() => base58CheckTronDecode(corrupted)).toThrow()
  })

  it('throws on a completely invalid string', () => {
    expect(() => base58CheckTronDecode('notanaddress')).toThrow()
  })

  it('throws when the decoded payload has a wrong network prefix (not 0x41 or 0xa0)', () => {
    // Valid bs58check encoding but with a 0x00 prefix (BTC P2PKH style, not Tron).
    // Verifies that prefix validation runs after checksum validation.
    expect(() => base58CheckTronDecode(NON_TRON_PREFIX_ADDRESS)).toThrow(/invalid tron address prefix/)
  })

  it('decodes a Nile testnet address (0xa0 prefix) successfully', async () => {
    // Encode a known 20-byte payload with 0xa0 prefix to produce a valid Nile address.
    // We import bs58check here to build the test fixture deterministically.
    const bs58check = await import('bs58check')
    const mod = bs58check as unknown as {
      encode?: (b: Uint8Array) => string
      default?: { encode: (b: Uint8Array) => string }
    }
    const encode = mod.encode ?? mod.default?.encode
    if (!encode) throw new Error('bs58check.encode unavailable in test')

    const evmBytes = Buffer.from(WALLET_ADDRESS_EVM_HEX, 'hex')
    const nilePayload = Buffer.concat([Buffer.from([0xa0]), evmBytes])
    const nileAddress = encode(nilePayload)

    // Must not throw and must return the same 20-byte EVM hex.
    const hex = base58CheckTronDecode(nileAddress)
    expect(hex).toBe(WALLET_ADDRESS_EVM_HEX)
    expect(hex).toHaveLength(40)
  })
})

describe('getTronCoinBalance (TRC20 eth_call calldata)', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('builds a well-formed eth_call with correct from address and 64-char ABI param', async () => {
    // Return a fake balance so the RPC decode path completes cleanly.
    queryUrlMock.mockResolvedValue({ result: '0x0000000000000000000000000000000000000000000000000000000000000064' })

    await getTronCoinBalance({
      chain: Chain.Tron,
      address: WALLET_ADDRESS,
      id: USDT_CONTRACT,
    })

    expect(queryUrlMock).toHaveBeenCalledTimes(1)

    // Extract the eth_call params from the call body.
    const body = queryUrlMock.mock.calls[0][1].body
    expect(body.method).toBe('eth_call')

    const callObj = body.params[0]

    // `from` must be the full "0x" + 40-char EVM hex — NOT truncated.
    expect(callObj.from).toBe(`0x${WALLET_ADDRESS_EVM_HEX}`)
    expect(callObj.from).toHaveLength(42) // "0x" + 40 chars

    // `to` must be the full "0x" + 40-char EVM hex of the contract.
    expect(callObj.to).toBe(`0x${VALID_ADDRESS_EVM_HEX}`)
    expect(callObj.to).toHaveLength(42)

    // `data` = 0x70a08231 (balanceOf selector, 8 hex chars) + 64-char ABI-encoded address param.
    // Total length: 2 ("0x") + 8 (selector) + 64 (param) = 74 chars.
    expect(callObj.data).toHaveLength(74)
    expect(callObj.data.startsWith('0x70a08231')).toBe(true)

    // The 64-char ABI param must be left-padded with 24 zero chars + 40-char wallet EVM hex.
    const abiParam = callObj.data.slice(10) // strip "0x70a08231"
    expect(abiParam).toHaveLength(64)
    expect(abiParam).toBe('000000000000000000000000' + WALLET_ADDRESS_EVM_HEX)
  })

  it('decodes the eth_call result into the correct bigint balance', async () => {
    // 100 * 1e6 = 100 USDT (6 decimals), hex = 0x5F5E100
    queryUrlMock.mockResolvedValue({ result: '0x0000000000000000000000000000000000000000000000000000000005F5E100' })

    const balance = await getTronCoinBalance({
      chain: Chain.Tron,
      address: WALLET_ADDRESS,
      id: USDT_CONTRACT,
    })

    expect(balance).toBe(100_000_000n)
  })

  it('propagates RPC errors instead of swallowing them', async () => {
    queryUrlMock.mockRejectedValue(new Error('network error'))

    await expect(
      getTronCoinBalance({
        chain: Chain.Tron,
        address: WALLET_ADDRESS,
        id: USDT_CONTRACT,
      })
    ).rejects.toThrow('network error')
  })

  it('propagates errors from TRC20 RPC JSON-RPC error response path', async () => {
    // Covers sendRPCRequest's error branch: `error.message` is passed into
    // intRpcCall's decode fn which calls BigInt() on the string. A JSON-RPC
    // error object with a human-readable message causes BigInt to throw a
    // SyntaxError - must propagate, not be swallowed.
    queryUrlMock.mockResolvedValue({ error: { message: 'Contract not found' } })

    await expect(
      getTronCoinBalance({
        chain: Chain.Tron,
        address: WALLET_ADDRESS,
        id: USDT_CONTRACT,
      })
    ).rejects.toThrow()
  })

  it('throws + logs on malformed RPC hex response', async () => {
    // should-fix: BigInt('0xZZZ') throws - intRpcCall must log + re-throw with context.
    queryUrlMock.mockResolvedValue({ result: '0xZZZ' })

    await expect(
      getTronCoinBalance({
        chain: Chain.Tron,
        address: WALLET_ADDRESS,
        id: USDT_CONTRACT,
      })
    ).rejects.toThrow(/malformed hex/)
  })
})

describe('getTronCoinBalance (native TRX)', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('returns the native TRX balance as bigint', async () => {
    queryUrlMock.mockResolvedValue({ balance: '1000000' })

    const balance = await getTronCoinBalance({
      chain: Chain.Tron,
      address: WALLET_ADDRESS,
    })

    expect(balance).toBe(1_000_000n)
  })

  it('propagates native TRX RPC transport errors (does not swallow to 0n)', async () => {
    // BLOCKER 1: same contract — native TRX path must propagate, not catch.
    queryUrlMock.mockRejectedValue(new Error('timeout'))

    await expect(
      getTronCoinBalance({
        chain: Chain.Tron,
        address: WALLET_ADDRESS,
      })
    ).rejects.toThrow('timeout')
  })

  it('throws + logs on malformed TRX balance value from RPC', async () => {
    // should-fix: BigInt('not-a-number') throws - must log + re-throw.
    queryUrlMock.mockResolvedValue({ balance: 'not-a-number' })

    await expect(
      getTronCoinBalance({
        chain: Chain.Tron,
        address: WALLET_ADDRESS,
      })
    ).rejects.toThrow(/malformed TRX balance/)
  })
})
