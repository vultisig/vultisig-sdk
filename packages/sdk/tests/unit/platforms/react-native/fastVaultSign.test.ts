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
const { fastVaultSign, schnorrSign, INTERNAL_FOR_TESTING } = await import(
  '../../../../src/platforms/react-native/mpc/fastVaultSign'
)

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

describe('fastVaultSign — r/s shape validation (CR R7 #5)', () => {
  // Pre-fix: r/s were concatenated without shape validation. A malformed MPC
  // engine response (truncated r, oversized s, non-hex bytes) would assemble
  // into a wrong-length signature that downstream verifiers may either
  // accept against a different curve point or reject opaquely.
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(keysign).mockReset()
  })

  it('throws when r is shorter than 32 bytes (truncated)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(31), // 62 hex chars — short
      s: 'bb'.repeat(32),
      recovery_id: '00',
    } as never)
    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/invalid r\/s/)
  })

  it('throws when s contains non-hex characters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'zz'.repeat(32), // non-hex
      recovery_id: '00',
    } as never)
    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/invalid r\/s/)
  })

  it('throws when r is longer than 32 bytes (oversized)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(33),
      s: 'bb'.repeat(32),
      recovery_id: '00',
    } as never)
    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: true })).rejects.toThrow(/invalid r\/s/)
  })

  it('also enforces r/s shape on EdDSA (path doesn\'t bypass the check)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'aa'.repeat(32),
      s: 'bb'.repeat(31), // truncated s
    } as never)
    await expect(fastVaultSign({ ...BASE_OPTS, isEcdsa: false })).rejects.toThrow(/invalid r\/s/)
  })
})

describe('schnorrSign — hex validation + Buffer.from path (CR R7 #4)', () => {
  // schnorrSign wraps fastVaultSign(isEcdsa: false) and converts r||s hex →
  // Uint8Array. Pre-fix the manual loop silently truncated on odd length and
  // produced NaN bytes for non-hex chars; we now validate the hex shape and
  // use `Buffer.from(_, 'hex')` (Buffer is polyfilled at RN entry).
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(keysign).mockReset()
  })

  it('returns a 64-byte Uint8Array on a well-formed signature', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    vi.mocked(keysign).mockResolvedValueOnce({
      r: 'a1'.repeat(32),
      s: 'b2'.repeat(32),
    } as never)
    const out = await schnorrSign({
      ...BASE_OPTS,
      derivePath: BASE_OPTS.serverDerivePath,
    } as never)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(64)
    // First byte = 0xa1, byte 32 = 0xb2 — proves Buffer.from interpreted hex
    // pairs correctly without spilling.
    expect(out[0]).toBe(0xa1)
    expect(out[32]).toBe(0xb2)
  })

  // The malformed-hex paths can't be exercised end-to-end through fastVaultSign
  // because the r/s shape guard in fastVaultSign now rejects bad hex first.
  // That's correct defense-in-depth: the schnorrSign-level validator is a
  // belt-and-braces guard for any future caller path that bypasses
  // fastVaultSign's shape check. The "well-formed signature" assertion above
  // is sufficient to lock in the Buffer.from migration.
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
