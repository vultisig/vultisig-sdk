// EIP-712 hash correctness for sign_typed_data.
//
// Regression coverage for the ClobAuthDomain bug: the executor's EIP-712
// implementation hardcoded the EIP712Domain type to all four standard
// fields, while the data encoder silently skipped absent ones. Domains
// that omit verifyingContract (Polymarket's ClobAuthDomain) produced a
// typeHash/data mismatch — a hash no verifier could reproduce, surfacing
// as CLOB `401 Invalid L1 Request headers` on every auto-submit.
//
// Canonical hashes are computed with viem's hashTypedData (same library
// the rest of the ecosystem verifies against), so these tests fail if the
// executor's hand-rolled encoder ever drifts from EIP-712 again.
import type { VaultBase } from '@vultisig/sdk'
import { hashTypedData } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

// Raw r||s (128 hex chars) — parseDERSignature passes it through unchanged.
const MOCK_RS_SIGNATURE = '0x' + 'ab'.repeat(32) + 'cd'.repeat(32)

function createSigningMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-eip712',
    type: 'fast',
    chains: [],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    signBytes: vi.fn().mockResolvedValue({
      signature: MOCK_RS_SIGNATURE,
      format: 'ECDSA',
      recovery: 0,
    }),
  } as unknown as VaultBase
}

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
}

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address', type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'message', type: 'string' },
  ],
}

// Real payloads captured from a live mcp-ts polymarket_place_bet envelope.
const ORDER_DOMAIN = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137,
  verifyingContract: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
}
const ORDER_MESSAGE = {
  salt: '6129131742476660',
  maker: '0x98e34Fc9C1dc67E980C62125b2e3a1535657fd32',
  signer: '0x98e34Fc9C1dc67E980C62125b2e3a1535657fd32',
  taker: '0x0000000000000000000000000000000000000000',
  tokenId: '4394372887385518214471608448209527405727552777602031099972143344338178308080',
  makerAmount: '1000000',
  takerAmount: '5917159',
  expiration: '0',
  nonce: '0',
  feeRateBps: '200',
  side: 0,
  signatureType: 0,
}

// ClobAuthDomain deliberately has NO verifyingContract — the regression case.
const CLOB_AUTH_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: 137 }
const CLOB_AUTH_MESSAGE = {
  address: '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
  timestamp: '1781158537',
  nonce: 0,
  message: 'This message attests that I control the given wallet',
}

function canonicalOrderHash(): string {
  return hashTypedData({
    domain: ORDER_DOMAIN as never,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: {
      ...ORDER_MESSAGE,
      salt: BigInt(ORDER_MESSAGE.salt),
      tokenId: BigInt(ORDER_MESSAGE.tokenId),
      makerAmount: BigInt(ORDER_MESSAGE.makerAmount),
      takerAmount: BigInt(ORDER_MESSAGE.takerAmount),
      expiration: BigInt(ORDER_MESSAGE.expiration),
      nonce: BigInt(ORDER_MESSAGE.nonce),
      feeRateBps: BigInt(ORDER_MESSAGE.feeRateBps),
    } as never,
  })
}

function canonicalClobAuthHash(): string {
  return hashTypedData({
    domain: CLOB_AUTH_DOMAIN as never,
    types: CLOB_AUTH_TYPES,
    primaryType: 'ClobAuth',
    message: {
      ...CLOB_AUTH_MESSAGE,
      nonce: BigInt(CLOB_AUTH_MESSAGE.nonce),
    } as never,
  })
}

// 5-field domain exercising the `salt` (bytes32) path — Polymarket doesn't
// use salt, but it's in EIP712_DOMAIN_FIELDS and was otherwise untested.
const SALT_DOMAIN = {
  name: 'Salted',
  version: '2',
  chainId: 137,
  verifyingContract: '0x1111111111111111111111111111111111111111',
  salt: '0x' + '00'.repeat(31) + '2a',
}
const SALT_TYPES = {
  Mail: [{ name: 'contents', type: 'string' }],
}
const SALT_MESSAGE = { contents: 'hello salt' }

function canonicalSaltHash(): string {
  return hashTypedData({
    domain: SALT_DOMAIN as never,
    types: SALT_TYPES,
    primaryType: 'Mail',
    message: SALT_MESSAGE as never,
  })
}

describe('signTypedData — EIP-712 hash correctness vs viem', () => {
  it('full 4-field domain (Polymarket Order) matches canonical hash', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-1', {
      domain: ORDER_DOMAIN,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: ORDER_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expect(recent.data?.hash).toBe(canonicalOrderHash())
  })

  it('3-field domain without verifyingContract (ClobAuthDomain) matches canonical hash', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-2', {
      domain: CLOB_AUTH_DOMAIN,
      types: CLOB_AUTH_TYPES,
      primaryType: 'ClobAuth',
      message: CLOB_AUTH_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expect(recent.data?.hash).toBe(canonicalClobAuthHash())
  })

  it('payloads[] mode (Polymarket Order + ClobAuth) signs both with canonical hashes and echoes markers', async () => {
    vi.useFakeTimers()
    try {
      const executor = new AgentExecutor(createSigningMockVault())

      const promise = executor.signTypedData('call-712-3', {
        payloads: [
          {
            id: 'order',
            primaryType: 'Order',
            domain: ORDER_DOMAIN,
            types: ORDER_TYPES,
            message: ORDER_MESSAGE,
            chain: 'Polygon',
          },
          {
            id: 'auth',
            primaryType: 'ClobAuth',
            domain: CLOB_AUTH_DOMAIN,
            types: CLOB_AUTH_TYPES,
            message: CLOB_AUTH_MESSAGE,
            chain: 'Ethereum',
          },
        ],
        pm_order_ref: 'order-ref-123',
        __pm_auto_submit: true,
      })
      // Skip the 5s inter-MPC-session sleep between the two payloads.
      await vi.advanceTimersByTimeAsync(5000)
      const recent = await promise

      expect(recent.success).toBe(true)
      const signatures = recent.data?.signatures as Array<Record<string, unknown>>
      expect(signatures).toHaveLength(2)
      expect(signatures[0].id).toBe('order')
      expect(signatures[0].hash).toBe(canonicalOrderHash())
      expect(signatures[1].id).toBe('auth')
      expect(signatures[1].hash).toBe(canonicalClobAuthHash())
      // 65-byte signature: r||s||v
      expect(signatures[0].signature).toMatch(/^0x[0-9a-f]{130}$/)

      expect(recent.data?.pm_order_ref).toBe('order-ref-123')
      expect(recent.data?.auto_submit).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('5-field domain with salt (bytes32) matches canonical hash', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-salt', {
      domain: SALT_DOMAIN,
      types: SALT_TYPES,
      primaryType: 'Mail',
      message: SALT_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expect(recent.data?.hash).toBe(canonicalSaltHash())
  })

  it('fails loud (no silent wrong hash) when a declared struct field is missing', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    // Drop a declared Order field. The old encoder silently skipped it and
    // produced a digest no verifier could reproduce; the guard must turn
    // that into a visible tool failure instead of a signed bad hash.
    const orderMissingTaker: Record<string, unknown> = { ...ORDER_MESSAGE }
    delete orderMissingTaker.taker
    const recent = await executor.signTypedData('call-712-missing', {
      domain: ORDER_DOMAIN,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: orderMissingTaker,
    })

    expect(recent.success).toBe(false)
    expect(String((recent.data as Record<string, unknown>).error)).toMatch(/missing value for declared field "taker"/)
  })

  it('fails loud when primaryType has no type definition (no empty-struct hash)', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    // primaryType says Order but `types` doesn't declare it. The old
    // getTypeFields returned undefined and callers encoded an empty
    // struct — hashing and signing a digest no verifier can reproduce.
    const recent = await executor.signTypedData('call-712-no-typedef', {
      domain: ORDER_DOMAIN,
      types: { NotOrder: ORDER_TYPES.Order },
      primaryType: 'Order',
      message: ORDER_MESSAGE,
    })

    expect(recent.success).toBe(false)
    expect(String((recent.data as Record<string, unknown>).error)).toMatch(/missing type definition for struct "Order"/)
  })

  it('caller-supplied explicit types.EIP712Domain matches canonical hash', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    // Typed-data builders in this repo emit an explicit EIP712Domain entry;
    // computeEIP712Hash must use it verbatim (separate branch from the
    // synthesized-domain path the tests above pin).
    const typesWithDomain = {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...ORDER_TYPES,
    }
    const recent = await executor.signTypedData('call-712-explicit-domain', {
      domain: ORDER_DOMAIN,
      types: typesWithDomain,
      primaryType: 'Order',
      message: ORDER_MESSAGE,
    })

    expect(recent.success).toBe(true)
    // viem ignores/synthesizes the domain type identically for the standard
    // 4-field domain, so the canonical Order hash is the same fixture.
    expect(recent.data?.hash).toBe(canonicalOrderHash())
  })
})
