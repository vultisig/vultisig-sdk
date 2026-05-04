import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mpc server message encoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
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
})
