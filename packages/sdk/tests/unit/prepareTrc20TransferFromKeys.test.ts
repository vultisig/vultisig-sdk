import { describe, expect, it } from 'vitest'

import { encodeTrc20TransferParam, tronBase58ToEvmHex, tronBase58ToHex, tronHexToBase58 } from '@/abi/tron'
import { prepareTrc20TransferFromKeys, TRC20_TRANSFER_SELECTOR } from '@/tools/prep/trc20'

// Real mainnet TRON addresses (base58check valid). USDT is the canonical TRC-20.
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const FROM = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const TO = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'

// 20-byte EVM-style hex (computed independently via base58check decode).
const USDT_EVM_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const TO_EVM_HEX = 'c8599111f29c1e1e061265b4af93ea1f274ad78a'

describe('tron abi address helpers', () => {
  it('decodes base58check → EVM hex (20 bytes, no prefix)', () => {
    expect(tronBase58ToEvmHex(USDT_CONTRACT)).toBe(USDT_EVM_HEX)
    expect(tronBase58ToEvmHex(TO)).toBe(TO_EVM_HEX)
  })

  it('decodes base58check → TRON hex (0x41 prefix)', () => {
    expect(tronBase58ToHex(USDT_CONTRACT)).toBe(`41${USDT_EVM_HEX}`)
  })

  it('round-trips hex → base58 → hex', () => {
    expect(tronHexToBase58(USDT_EVM_HEX)).toBe(USDT_CONTRACT)
    expect(tronHexToBase58(`41${TO_EVM_HEX}`)).toBe(TO)
  })

  it('rejects a base58check checksum mismatch (fund-safety guard)', () => {
    // Flip the last char of a valid address → checksum no longer matches.
    const typo = `${TO.slice(0, -1)}${TO.endsWith('H') ? 'J' : 'H'}`
    expect(() => tronBase58ToEvmHex(typo)).toThrow(/checksum mismatch|expected 25-byte/)
  })

  it('rejects a non-base58 character', () => {
    expect(() => tronBase58ToEvmHex('T0OIl_not_base58')).toThrow(/invalid character/)
  })
})

describe('encodeTrc20TransferParam', () => {
  it('encodes recipient word || amount word (128 hex chars, no 0x)', () => {
    const param = encodeTrc20TransferParam(TO, '1000000')
    expect(param).toHaveLength(128)
    // Recipient word: 20-byte addr left-padded to 32 bytes (24 zero hex chars).
    expect(param.slice(0, 64)).toBe(`${'0'.repeat(24)}${TO_EVM_HEX}`)
    // Amount word: 1_000_000 = 0xf4240 left-padded to 32 bytes.
    expect(param.slice(64)).toBe('00000000000000000000000000000000000000000000000000000000000f4240')
  })

  it('encodes uint256-max amount without overflow', () => {
    const max = (1n << 256n) - 1n
    const param = encodeTrc20TransferParam(TO, max.toString())
    expect(param.slice(64)).toBe('f'.repeat(64))
  })

  it('rejects a negative amount', () => {
    expect(() => encodeTrc20TransferParam(TO, '-1')).toThrow(/negative amount/)
  })

  it('rejects an amount >= 2^256', () => {
    expect(() => encodeTrc20TransferParam(TO, (1n << 256n).toString())).toThrow(/exceeds uint256/)
  })
})

describe('prepareTrc20TransferFromKeys', () => {
  it('builds an unsigned USDT transfer descriptor (pure crypto, no RPC)', () => {
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '1000000', // 1 USDT (6 decimals)
    })

    expect(tx.chain).toBe('Tron')
    expect(tx.action).toBe('transfer')
    expect(tx.signingMode).toBe('ecdsa_secp256k1')
    expect(tx.ownerAddress).toBe(FROM)
    expect(tx.contractAddress).toBe(USDT_CONTRACT)
    expect(tx.toAddress).toBe(TO)
    expect(tx.functionSelector).toBe(TRC20_TRANSFER_SELECTOR)
    expect(tx.functionSelector).toBe('transfer(address,uint256)')
    expect(tx.parameter).toBe(encodeTrc20TransferParam(TO, '1000000'))
    expect(tx.feeLimitSun).toBe('100000000')
    expect(tx.amount).toBe('1000000')
    // No memo unless requested.
    expect('memo' in tx).toBe(false)
  })

  it('forwards a memo when provided (THORChain / exchange deposit memos)', () => {
    const memo = 'SWAP:BTC.BTC:bc1qexample:0'
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '500000',
      memo,
    })
    expect(tx.memo).toBe(memo)
  })

  it('honors a custom feeLimitSun', () => {
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '1',
      feeLimitSun: '50000000',
    })
    expect(tx.feeLimitSun).toBe('50000000')
  })

  it('rejects a zero amount', () => {
    expect(() =>
      prepareTrc20TransferFromKeys({ contractAddress: USDT_CONTRACT, from: FROM, to: TO, amount: '0' })
    ).toThrow(/greater than zero/)
  })

  // Fund-safety / WYSIWYS: BigInt() is too permissive for a value-bearing
  // field. A "0x10"/"0b1010"/"+1000"/whitespace amount must be REJECTED, not
  // silently coerced (which would leak a non-decimal string into tx.amount
  // while the calldata moves a different/confusing base-unit value).
  it.each([
    ['hex', '0x10'],
    ['binary', '0b1010'],
    ['octal', '0o17'],
    ['explicit plus', '+1000'],
    ['leading/trailing whitespace', ' 1000000 '],
    ['decimal point', '1.5'],
    ['scientific', '1e6'],
    ['underscore separator', '1_000'],
    ['garbage', 'abc'],
    ['empty', ''],
  ])('rejects a non-plain-decimal amount (%s: %j)', (_label, amount) => {
    expect(() => prepareTrc20TransferFromKeys({ contractAddress: USDT_CONTRACT, from: FROM, to: TO, amount })).toThrow(
      /plain decimal integer string|greater than zero/
    )
  })

  it('echoes the CANONICAL decimal amount (no leading zeros leak)', () => {
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '0000001000000',
    })
    // tx.amount must equal what the calldata actually encodes, normalized.
    expect(tx.amount).toBe('1000000')
    expect(tx.parameter).toBe(encodeTrc20TransferParam(TO, '1000000'))
  })

  it('rejects a malformed feeLimitSun (value-adjacent guard)', () => {
    expect(() =>
      prepareTrc20TransferFromKeys({
        contractAddress: USDT_CONTRACT,
        from: FROM,
        to: TO,
        amount: '1',
        feeLimitSun: '0x10',
      })
    ).toThrow(/feeLimitSun must be a plain decimal/)
    expect(() =>
      prepareTrc20TransferFromKeys({
        contractAddress: USDT_CONTRACT,
        from: FROM,
        to: TO,
        amount: '1',
        feeLimitSun: '0',
      })
    ).toThrow(/feeLimitSun must be greater than zero/)
    expect(() =>
      prepareTrc20TransferFromKeys({
        contractAddress: USDT_CONTRACT,
        from: FROM,
        to: TO,
        amount: '1',
        feeLimitSun: '-5',
      })
    ).toThrow(/feeLimitSun must be a plain decimal/)
  })

  it('canonicalizes a valid feeLimitSun', () => {
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '1',
      feeLimitSun: '050000000',
    })
    expect(tx.feeLimitSun).toBe('50000000')
  })

  it('rejects an invalid (bad-checksum) recipient before encoding (fund-safety)', () => {
    const typo = `${TO.slice(0, -1)}${TO.endsWith('H') ? 'J' : 'H'}`
    expect(() =>
      prepareTrc20TransferFromKeys({ contractAddress: USDT_CONTRACT, from: FROM, to: typo, amount: '1000000' })
    ).toThrow(/checksum mismatch|expected 25-byte/)
  })

  it('NEVER produces signing material (no privkey / signature fields)', () => {
    const tx = prepareTrc20TransferFromKeys({
      contractAddress: USDT_CONTRACT,
      from: FROM,
      to: TO,
      amount: '1000000',
    })
    const keys = Object.keys(tx)
    for (const forbidden of ['privateKey', 'signature', 'sig', 'signed', 'rawTx', 'broadcast']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
