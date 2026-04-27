import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the MPC keysign + the relay-session helpers so the test never hits the
// network. The assertions focus on fastVaultSign's signature-assembly logic.
vi.mock('@vultisig/core-mpc/keysign', () => ({
  keysign: vi.fn(),
}))
vi.mock('../../../../src/platforms/react-native/mpc/relay', () => ({
  joinRelaySession: vi.fn(async () => {}),
  startRelaySession: vi.fn(async () => {}),
  waitForParties: vi.fn(async () => ['local', 'server']),
}))

const { keysign } = await import('@vultisig/core-mpc/keysign')
const { fastVaultSign, INTERNAL_FOR_TESTING } = await import('../../../../src/platforms/react-native/mpc/fastVaultSign')

const BASE_OPTS = {
  keyshareBase64: 'ZmFrZQ==',
  messageHashHex: '00'.repeat(32),
  serverDerivePath: "m/44'/60'/0'/0/0",
  localDerivePath: "m/44'/60'/0'/0/0",
  localPartyId: 'local',
  vaultPassword: 'pw',
  publicKeyEcdsa: 'aa'.repeat(33),
  vultiServerUrl: 'https://api.vultisig.com/vault',
  relayUrl: 'https://api.vultisig.com/router',
  maxAttempts: 1,
}

describe('fastVaultSign — ECDSA recovery_id handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(keysign).mockReset()
  })

  it('throws when MPC returns ECDSA signature without recovery_id', async () => {
    // VultiServer POST — respond 200 so the flow reaches keysign.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      // no recovery_id — this is the bug scenario
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/recovery_id/)
  })

  it('throws when recovery_id is an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: '',
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/recovery_id/)
  })

  it('normalises single-char recovery_id to two hex chars', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: '1', // engine may emit single char — normalise without dropping
    } as never)

    const sig = await fastVaultSign({ ...BASE_OPTS, isEcdsa: true })
    expect(sig).toBe('aa'.repeat(32) + 'bb'.repeat(32) + '01')
  })

  it('returns r||s without recovery_id for EdDSA signatures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
    } as never)

    const sig = await fastVaultSign({ ...BASE_OPTS, isEcdsa: false })
    expect(sig).toBe('aa'.repeat(32) + 'bb'.repeat(32))
  })

  it('rejects non-hex recovery_id (would silently coerce to NaN otherwise)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: 'xy', // non-hex — must not fall through to `r || s || 'xy'`
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/recovery_id/)
  })

  it('rejects out-of-range recovery_id (must be 0-3)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    )
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(32),
      recovery_id: '04', // ECDSA recovery_id is always 0-3
    } as never)

    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/recovery_id/)
  })
})

describe('fastVaultSign — randomUUID fallback (CR item #9)', () => {
  // The fallback path runs when `globalThis.crypto.randomUUID` is missing
  // but `globalThis.crypto.getRandomValues` is present (older RN runtimes).
  // Pre-fix: if both were missing, we'd silently emit a UUID derived from an
  // all-zero buffer — every relay session collides on the server.
  // Post-fix: we throw consistently with `randomHex`.

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses globalThis.crypto.randomUUID when present', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
    })
    const out = INTERNAL_FOR_TESTING.randomUUID()
    expect(out).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('falls back to getRandomValues when randomUUID missing', () => {
    // No randomUUID, but getRandomValues fills buffer with deterministic non-zero bytes.
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (i + 1) & 0xff
        return a
      },
    })
    const uuid = INTERNAL_FOR_TESTING.randomUUID()
    // v4 shape: 8-4-4-4-12, version nibble 4, variant nibble 8/9/a/b
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    // bytes were 01,02,03,04,05,06,07,08,... → after v4/variant masks the
    // hex is deterministic enough that we can pin the byte sequence.
    // (b[6] = 0x07 → (0x07 & 0x0f) | 0x40 = 0x47; b[8] = 0x09 → (0x09 & 0x3f) | 0x80 = 0x89)
    expect(uuid.slice(14, 16)).toBe('47')
    expect(uuid.slice(19, 21)).toBe('89')
  })

  it('throws when both randomUUID and getRandomValues are missing', () => {
    // This is the bug shape: `rng?.getRandomValues?.(b)` was a silent no-op,
    // leaving b = all zeros and emitting `00000000-0000-4000-8000-000000000000`.
    // Server-side, every session uses the same id → cross-tenant collision.
    vi.stubGlobal('crypto', {})
    expect(() => INTERNAL_FOR_TESTING.randomUUID()).toThrow(/getRandomValues not available/)
  })

  it('throws when crypto is entirely undefined', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => INTERNAL_FOR_TESTING.randomUUID()).toThrow(/getRandomValues not available/)
  })
})
