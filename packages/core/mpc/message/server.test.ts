import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mpc server message encoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    delete process.env.VULTISIG_DIAG_MPC_RELAY
  })

  it('round-trips when globalThis.Buffer is undefined (browser-like)', async () => {
    vi.stubGlobal('Buffer', undefined)
    vi.resetModules()

    const { fromMpcServerMessage, toMpcServerMessage } = await import('./server')

    const hexEncryptionKey = 'a'.repeat(64)
    const body = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

    const encoded = toMpcServerMessage(body, hexEncryptionKey)
    const decoded = fromMpcServerMessage(encoded, hexEncryptionKey)

    expect(new Uint8Array(decoded)).toEqual(body)
  })

  it('does not call console.log when VULTISIG_DIAG_MPC_RELAY is unset', async () => {
    delete process.env.VULTISIG_DIAG_MPC_RELAY
    vi.resetModules()

    const consoleSpy = vi.spyOn(console, 'log')
    const { fromMpcServerMessage, toMpcServerMessage } = await import('./server')

    const hexEncryptionKey = 'b'.repeat(64)
    const body = new Uint8Array([0x01, 0x02, 0x03])

    const encoded = toMpcServerMessage(body, hexEncryptionKey)
    fromMpcServerMessage(encoded, hexEncryptionKey)

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[DIAG-MPC-RELAY]'), expect.anything())
    consoleSpy.mockRestore()
  })

  it('calls console.log with expected fields when VULTISIG_DIAG_MPC_RELAY=1', async () => {
    process.env.VULTISIG_DIAG_MPC_RELAY = '1'
    vi.resetModules()

    const consoleSpy = vi.spyOn(console, 'log')
    const { fromMpcServerMessage, toMpcServerMessage } = await import('./server')

    const hexEncryptionKey = 'c'.repeat(64)
    const body = new Uint8Array([0xca, 0xfe, 0xba, 0xbe])

    const encoded = toMpcServerMessage(body, hexEncryptionKey)
    fromMpcServerMessage(encoded, hexEncryptionKey)

    expect(consoleSpy).toHaveBeenCalledWith('[DIAG-MPC-RELAY]', expect.stringMatching(/"body_len":\d+/))
    expect(consoleSpy).toHaveBeenCalledWith('[DIAG-MPC-RELAY]', expect.stringMatching(/"nonce_hex":"[0-9a-f]{24}"/))
    // key_fingerprint is a sha256-truncated digest of DECODED key bytes, not
    // hex text or raw key material. Hex-text hashing would split the same key
    // into two fingerprints based on caller-side casing.
    expect(consoleSpy).toHaveBeenCalledWith(
      '[DIAG-MPC-RELAY]',
      expect.stringMatching(/"key_fingerprint":"[0-9a-f]{16}"/)
    )
    // Negative: never log the raw key prefix shape (key_first16 was the pre-fix logger).
    expect(consoleSpy).not.toHaveBeenCalledWith('[DIAG-MPC-RELAY]', expect.stringMatching(/"key_first16":/))
    consoleSpy.mockRestore()
  })

  it('key_fingerprint is stable across uppercase/lowercase hex variants of the same key', async () => {
    process.env.VULTISIG_DIAG_MPC_RELAY = '1'
    vi.resetModules()

    const consoleSpy = vi.spyOn(console, 'log')
    const { fromMpcServerMessage, toMpcServerMessage } = await import('./server')

    const lowerKey = 'c'.repeat(64)
    const upperKey = 'C'.repeat(64)
    const body = new Uint8Array([0xca, 0xfe])

    const encoded = toMpcServerMessage(body, lowerKey)
    fromMpcServerMessage(encoded, lowerKey)
    fromMpcServerMessage(encoded, upperKey)

    const calls = consoleSpy.mock.calls.filter(c => c[0] === '[DIAG-MPC-RELAY]')
    const fingerprints = calls.map(c => {
      const parsed = JSON.parse(c[1] as string)
      return parsed.key_fingerprint as string
    })
    expect(fingerprints).toHaveLength(2)
    expect(fingerprints[0]).toBe(fingerprints[1])
    consoleSpy.mockRestore()
  })
})
