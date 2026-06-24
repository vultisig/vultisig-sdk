// EIP-712 signing correctness for sign_typed_data.
//
// The executor used to hand-roll the EIP-712 struct encoder, the DER→r||s
// parse, and the 65-byte signature assembly. Three independent defects lived
// there: a hardcoded EIP712Domain field set (wrong domainSeparator for
// Polymarket's ClobAuthDomain / salted domains), no low-S canonicalization
// (malleable, OZ-ECDSA-rejected signatures), and no recover-verify gate (a
// wrong v / digest mismatch returned as success). This suite pins the fix:
//
//   - the digest now comes from viem's `hashTypedData` and is pinned against
//     BOTH viem AND ethers `TypedDataEncoder.hash` (the app's reference
//     encoder, vultiagent-app/src/services/eip712Signing.ts) for a flat
//     ERC-2612 permit and the Polymarket Order + ClobAuth payload-array;
//   - `toCanonicalEvmSignature` folds a high-S value into the low half and
//     flips the recovery parity;
//   - `signSingleTypedData` recover-verifies the assembled signature against
//     the vault's EVM address and throws SIGNATURE_RECOVERY_MISMATCH otherwise.
import type { VaultBase } from '@vultisig/sdk'
import { TypedDataEncoder } from 'ethers'
import { hashTypedData } from 'viem'
import { privateKeyToAddress, sign } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor, toCanonicalEvmSignature } from '../executor'

// secp256k1 group order — duplicated here (the impl constant is module-private)
// so the low-S test pins the fold against an independent literal.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

// Deterministic test keyshare. The mock vault "signs" each digest with this
// key (viem's `sign` is RFC-6979 deterministic and already low-S), and
// reports its address — so the executor's recover-verify gate passes for
// every well-formed payload below.
const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const TEST_ADDRESS = privateKeyToAddress(TEST_PRIVATE_KEY)

// signBytes shape returned by the SDK: raw r||s (128 hex) + recovery id.
async function mockSign(hash: string): Promise<{ signature: string; format: string; recovery: number }> {
  const sig = await sign({ hash: hash as `0x${string}`, privateKey: TEST_PRIVATE_KEY })
  return { signature: '0x' + sig.r.slice(2) + sig.s.slice(2), format: 'ECDSA', recovery: sig.yParity }
}

function createSigningMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-eip712',
    type: 'fast',
    chains: [],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue(TEST_ADDRESS),
    signBytes: vi.fn(async ({ data }: { data: string }) => mockSign(data)),
  } as unknown as VaultBase
}

// Pin a digest against the two independent reference encoders — viem (what
// the executor now uses) and ethers (what the app uses). Agreement between
// two distinct implementations is the canonical-correctness guarantee.
function expectCanonicalHash(
  actual: unknown,
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
  message: Record<string, unknown>
): void {
  const viemHash = hashTypedData({ domain, types, primaryType, message } as Parameters<typeof hashTypedData>[0])
  const ethersHash = TypedDataEncoder.hash(domain, types, message)
  expect(viemHash).toBe(ethersHash)
  expect(actual).toBe(viemHash)
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

// Flat ERC-2612 permit (USDC mainnet domain).
const PERMIT_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 1,
  verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
}
const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
const PERMIT_MESSAGE = {
  owner: '0x98e34Fc9C1dc67E980C62125b2e3a1535657fd32',
  spender: '0x1111111254EEB25477B68fb85Ed929f73A960582',
  value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  nonce: '0',
  deadline: '1781158537',
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

// 5-field domain exercising the `salt` (bytes32) path.
const SALT_DOMAIN = {
  name: 'Salted',
  version: '2',
  chainId: 137,
  verifyingContract: '0x1111111111111111111111111111111111111111',
  salt: '0x' + '00'.repeat(31) + '2a',
}
const SALT_TYPES = { Mail: [{ name: 'contents', type: 'string' }] }
const SALT_MESSAGE = { contents: 'hello salt' }

// Nested struct + array-of-struct (the canonical EIP-712 Mail example) — the
// removed hand-rolled encoder had its own recursive struct / array path; this
// pins viem's handling of `Person[]` and a nested `Person` member vs ethers.
const NESTED_DOMAIN = {
  name: 'Ether Mail',
  version: '1',
  chainId: 1,
  verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
}
const NESTED_TYPES = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallets', type: 'address[]' },
  ],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person[]' },
    { name: 'contents', type: 'string' },
  ],
}
const NESTED_MESSAGE = {
  from: {
    name: 'Cow',
    wallets: ['0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826', '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'],
  },
  to: [
    {
      name: 'Bob',
      wallets: [
        '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        '0xB0BdaBea57B0BDABeA57b0bdABEA57b0BDabEa57',
        '0xB0B0b0b0b0b0B000000000000000000000000000',
      ],
    },
  ],
  contents: 'Hello, Bob!',
}

describe('signTypedData — EIP-712 digest pinned vs viem AND ethers', () => {
  it('flat ERC-2612 permit matches both reference encoders', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-permit', {
      domain: PERMIT_DOMAIN,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: PERMIT_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expectCanonicalHash(recent.data?.hash, PERMIT_DOMAIN, PERMIT_TYPES, 'Permit', PERMIT_MESSAGE)
  })

  it('string chainId hashes identically to the numeric form (matches ethers/on-chain)', async () => {
    // The JSON wire occasionally double-stringifies chainId. viem hashes a
    // string chainId to a DIFFERENT digest than the numeric form, but ethers
    // (the app encoder + on-chain DOMAIN_SEPARATOR) coerces both to the same
    // value. The executor must coerce so its digest matches the contract's.
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-permit-strchainid', {
      domain: { ...PERMIT_DOMAIN, chainId: String(PERMIT_DOMAIN.chainId) },
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: PERMIT_MESSAGE,
    })

    expect(recent.success).toBe(true)
    // Pin against the NUMERIC-chainId canonical hash (viem == ethers).
    expectCanonicalHash(recent.data?.hash, PERMIT_DOMAIN, PERMIT_TYPES, 'Permit', PERMIT_MESSAGE)
  })

  it('full 4-field domain (Polymarket Order) matches both reference encoders', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-1', {
      domain: ORDER_DOMAIN,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: ORDER_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expectCanonicalHash(recent.data?.hash, ORDER_DOMAIN, ORDER_TYPES, 'Order', ORDER_MESSAGE)
  })

  it('3-field domain without verifyingContract (ClobAuthDomain) matches both reference encoders', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-2', {
      domain: CLOB_AUTH_DOMAIN,
      types: CLOB_AUTH_TYPES,
      primaryType: 'ClobAuth',
      message: CLOB_AUTH_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expectCanonicalHash(recent.data?.hash, CLOB_AUTH_DOMAIN, CLOB_AUTH_TYPES, 'ClobAuth', CLOB_AUTH_MESSAGE)
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
      expectCanonicalHash(signatures[0].hash, ORDER_DOMAIN, ORDER_TYPES, 'Order', ORDER_MESSAGE)
      expect(signatures[1].id).toBe('auth')
      expectCanonicalHash(signatures[1].hash, CLOB_AUTH_DOMAIN, CLOB_AUTH_TYPES, 'ClobAuth', CLOB_AUTH_MESSAGE)
      // 65-byte signature: r||s||v
      expect(signatures[0].signature).toMatch(/^0x[0-9a-f]{130}$/)

      expect(recent.data?.pm_order_ref).toBe('order-ref-123')
      expect(recent.data?.auto_submit).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('5-field domain with salt (bytes32) matches both reference encoders', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-salt', {
      domain: SALT_DOMAIN,
      types: SALT_TYPES,
      primaryType: 'Mail',
      message: SALT_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expectCanonicalHash(recent.data?.hash, SALT_DOMAIN, SALT_TYPES, 'Mail', SALT_MESSAGE)
  })

  it('nested struct + array-of-struct (Ether Mail) matches both reference encoders', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-nested', {
      domain: NESTED_DOMAIN,
      types: NESTED_TYPES,
      primaryType: 'Mail',
      message: NESTED_MESSAGE,
    })

    expect(recent.success).toBe(true)
    expectCanonicalHash(recent.data?.hash, NESTED_DOMAIN, NESTED_TYPES, 'Mail', NESTED_MESSAGE)
  })

  it('caller-supplied explicit types.EIP712Domain is stripped and matches canonical hash', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    // Typed-data builders in this repo emit an explicit EIP712Domain entry;
    // viem rejects `primaryType` if it survives, so the executor must strip it.
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
    expectCanonicalHash(recent.data?.hash, ORDER_DOMAIN, ORDER_TYPES, 'Order', ORDER_MESSAGE)
  })
})

describe('signTypedData — fail-loud on malformed payloads (viem validation)', () => {
  it('fails when a declared struct field is missing (no silent wrong hash)', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    // Drop a declared Order field. The old encoder silently skipped it and
    // produced a digest no verifier could reproduce; viem throws instead.
    const orderMissingTaker: Record<string, unknown> = { ...ORDER_MESSAGE }
    delete orderMissingTaker.taker
    const recent = await executor.signTypedData('call-712-missing', {
      domain: ORDER_DOMAIN,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: orderMissingTaker,
    })

    expect(recent.success).toBe(false)
    expect(String((recent.data as Record<string, unknown>).error)).toMatch(/invalid|undefined/i)
  })

  it('fails when primaryType has no type definition (no empty-struct hash)', async () => {
    const executor = new AgentExecutor(createSigningMockVault())

    const recent = await executor.signTypedData('call-712-no-typedef', {
      domain: ORDER_DOMAIN,
      types: { NotOrder: ORDER_TYPES.Order },
      primaryType: 'Order',
      message: ORDER_MESSAGE,
    })

    expect(recent.success).toBe(false)
    expect(String((recent.data as Record<string, unknown>).error)).toMatch(/Invalid primary type|Order/i)
  })
})

describe('toCanonicalEvmSignature — low-S (EIP-2)', () => {
  const R = 'aa'.repeat(32)

  it('folds a high-S value into the low half and flips the recovery parity', () => {
    const sHigh = (SECP256K1_N - 1n).toString(16).padStart(64, '0')
    const out = toCanonicalEvmSignature('0x' + R + sHigh, 0)

    // n - (n - 1) = 1
    expect(out.s).toBe('1'.padStart(64, '0'))
    expect(BigInt('0x' + out.s) <= SECP256K1_N >> 1n).toBe(true)
    expect(out.recovery).toBe(1)
    expect(out.r).toBe(R)
  })

  it('passes a canonical low-S value through unchanged', () => {
    const sLow = 2n.toString(16).padStart(64, '0')
    const out = toCanonicalEvmSignature('0x' + R + sLow, 1)

    expect(out.s).toBe(sLow)
    expect(out.recovery).toBe(1)
  })
})

describe('signSingleTypedData — recover-verify gate', () => {
  it('throws SIGNATURE_RECOVERY_MISMATCH when the assembled signature does not recover to the vault address', async () => {
    // signBytes returns a valid r/s but the WRONG recovery parity, so the
    // assembled v recovers to a different address than the vault's.
    const vault = {
      name: 'mock-vault',
      id: 'vault-mock-eip712-bad',
      type: 'fast',
      chains: [],
      isEncrypted: false,
      address: vi.fn().mockResolvedValue(TEST_ADDRESS),
      signBytes: vi.fn(async ({ data }: { data: string }) => {
        const ok = await mockSign(data)
        return { ...ok, recovery: ok.recovery ^ 1 }
      }),
    } as unknown as VaultBase

    const executor = new AgentExecutor(vault)
    const recent = await executor.signTypedData('call-712-badrec', {
      domain: PERMIT_DOMAIN,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: PERMIT_MESSAGE,
    })

    expect(recent.success).toBe(false)
    expect(String((recent.data as Record<string, unknown>).error)).toMatch(/SIGNATURE_RECOVERY_MISMATCH/)
  })

  it('surfaces an actionable, non-retryable vault-context error on recover-verify mismatch', async () => {
    // Wrong-vault-context path: the vault loaded into the executor reports an
    // EVM address that the recovered signer can never match (e.g. the wrong
    // vault/keyshare is loaded). The failure must point at vault context and
    // read as deterministic, not retryable — per the PR #852 review follow-up.
    const WRONG_VAULT_ADDRESS = '0x000000000000000000000000000000000000dEaD'
    const vault = {
      name: 'mock-vault',
      id: 'vault-mock-eip712-wrongctx',
      type: 'fast',
      chains: [],
      isEncrypted: false,
      // address() reports a vault address the real signer can never recover to.
      address: vi.fn().mockResolvedValue(WRONG_VAULT_ADDRESS),
      // signBytes signs correctly with TEST_PRIVATE_KEY (→ TEST_ADDRESS).
      signBytes: vi.fn(async ({ data }: { data: string }) => mockSign(data)),
    } as unknown as VaultBase

    const executor = new AgentExecutor(vault)
    const recent = await executor.signTypedData('call-712-wrongctx', {
      domain: PERMIT_DOMAIN,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: PERMIT_MESSAGE,
    })

    expect(recent.success).toBe(false)
    const error = String((recent.data as Record<string, unknown>).error)
    // Stable machine-readable prefix that callers key off.
    expect(error).toMatch(/SIGNATURE_RECOVERY_MISMATCH/)
    // Names vault context as the cause, not a generic signing failure.
    expect(error).toMatch(/vault context/i)
    // Names the concrete loaded vault (name + id) so the operator can tell
    // which vault is in context.
    expect(error).toContain('mock-vault')
    expect(error).toContain('vault-mock-eip712-wrongctx')
    // Signals it is deterministic and retrying will not help.
    expect(error).toMatch(/retrying will not help/i)
    // Surfaces both addresses so the mismatch is debuggable.
    expect(error).toContain(WRONG_VAULT_ADDRESS)
    expect(error).toContain(TEST_ADDRESS)
  })

  it('returns a signature that recovers to the vault EVM address', async () => {
    const executor = new AgentExecutor(createSigningMockVault())
    const recent = await executor.signTypedData('call-712-goodrec', {
      domain: PERMIT_DOMAIN,
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: PERMIT_MESSAGE,
    })

    expect(recent.success).toBe(true)
    // Low-S invariant on the returned signature.
    const s = BigInt(recent.data?.s as string)
    expect(s <= SECP256K1_N >> 1n).toBe(true)
    expect(recent.data?.signature).toMatch(/^0x[0-9a-f]{130}$/)
  })
})
