// Agent auth primitives — first tests for auth.ts (audit fix-07 finding e).
//
// A regression in the EIP-191 personal_sign hash or the DER→65-byte signature
// formatting silently breaks ALL agent auth (every backend request 401s), so
// these pin both against an independent implementation + frozen vectors, and
// lock the MPC-signing retry classification.
import { keccak_256 } from '@noble/hashes/sha3.js'
import { hashMessage } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { authenticateVault, computePersonalSignHash, formatSignature65 } from '../auth'

describe('computePersonalSignHash (EIP-191 personal_sign)', () => {
  it('matches viem.hashMessage (independent impl) for a frozen auth message', () => {
    // The exact JSON shape authenticateVault signs (message/nonce/expiresAt/address).
    const frozen = JSON.stringify({
      message: 'Sign into Vultisig Plugin Marketplace',
      nonce: '0xfeedface',
      expiresAt: '2026-06-25T00:00:00.000Z',
      address: '0x1111111111111111111111111111111111111111',
    })
    const got = Buffer.from(computePersonalSignHash(frozen)).toString('hex')
    expect('0x' + got).toBe(hashMessage(frozen))
    // Cross-checks the keccak256 of "\x19Ethereum Signed Message:\n"+len+msg —
    // the same digest agent-backend's sig.go reconstructs and Ecrecovers. len is
    // the UTF-8 BYTE length (Buffer.byteLength), not the char count.
    expect(got).toBe(
      Buffer.from(
        keccak_256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${Buffer.byteLength(frozen)}${frozen}`))
      ).toString('hex')
    )
  })

  it('matches the canonical "hello world" personal_sign vector', () => {
    expect('0x' + Buffer.from(computePersonalSignHash('hello world')).toString('hex')).toBe(
      '0xd9eba16ed0ecae432b71fe008c98cc872bb4cc214d3220a36f365326cf807d68'
    )
  })

  it('byte-length prefix counts UTF-8 bytes, not characters', () => {
    // A multibyte string: the prefix must use the encoded byte length.
    const multibyte = 'café €'
    expect('0x' + Buffer.from(computePersonalSignHash(multibyte)).toString('hex')).toBe(hashMessage(multibyte))
  })
})

describe('formatSignature65 (DER / raw → r||s||v)', () => {
  // r has its high bit set (0xf0…) so DER prepends a 0x00 sign byte; decoding
  // must strip it back to 32 bytes. s (0x02…) needs no padding.
  const r = 'f0' + '11'.repeat(31)
  const s = '02' + '22'.repeat(31)
  const der = '30' + '45' + '02' + '21' + '00' + r + '02' + '20' + s

  it('decodes a DER signature and appends v = recovery + 27', () => {
    expect(formatSignature65(der, 0)).toBe(r + s + '1b')
    expect(formatSignature65(der, 1)).toBe(r + s + '1c')
  })

  it('tolerates a 0x-prefixed DER input', () => {
    expect(formatSignature65('0x' + der, 0)).toBe(r + s + '1b')
  })

  it('passes through an already-raw 64-byte r||s and appends v', () => {
    const rs = 'aa'.repeat(32) + 'bb'.repeat(32)
    expect(formatSignature65(rs, 1)).toBe(rs + '1c')
  })

  it('throws on an unrecognized length (not DER, not 64-byte raw)', () => {
    expect(() => formatSignature65('abcdef', 0)).toThrow(/unrecognized format/)
  })
})

describe('authenticateVault — MPC signing retry classification', () => {
  function makeVault(signBytes: ReturnType<typeof vi.fn>) {
    return {
      publicKeys: { ecdsa: '02abc' },
      hexChainCode: 'cc',
      address: vi.fn(async () => '0x1111111111111111111111111111111111111111'),
      signBytes,
    } as any
  }

  const rawSig = { signature: 'aa'.repeat(32) + 'bb'.repeat(32), recovery: 0 }

  it('retries on a transient "timeout" error then succeeds, and surfaces the refresh token', async () => {
    const signBytes = vi.fn().mockRejectedValueOnce(new Error('signing timeout')).mockResolvedValueOnce(rawSig)
    const client = {
      authenticate: vi.fn(async () => ({
        token: 'access-tok',
        expires_at: 1893456000,
        access_token: 'access-tok',
        refresh_token: 'refresh-tok',
      })),
    } as any

    const result = await authenticateVault(client, makeVault(signBytes), undefined, 3)

    expect(signBytes).toHaveBeenCalledTimes(2)
    expect(client.authenticate).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ token: 'access-tok', expiresAt: 1893456000, refreshToken: 'refresh-tok' })
  })

  it('rethrows immediately (no retry) on a non-timeout error', async () => {
    const signBytes = vi.fn().mockRejectedValue(new Error('user rejected signature'))
    const client = { authenticate: vi.fn() } as any

    await expect(authenticateVault(client, makeVault(signBytes), undefined, 3)).rejects.toThrow(
      /user rejected signature/
    )
    expect(signBytes).toHaveBeenCalledTimes(1)
    expect(client.authenticate).not.toHaveBeenCalled()
  })
})
