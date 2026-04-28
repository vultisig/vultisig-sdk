import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => '11111111-2222-3333-4444-555555555555'),
  getRandomValues: vi.fn(<T extends ArrayBufferView | null>(a: T) => a),
}))

const { ReactNativeCrypto } = await import('../../../../src/platforms/react-native/crypto')

describe('ReactNativeCrypto', () => {
  it('delegates randomUUID to expo-crypto', () => {
    const crypto = new ReactNativeCrypto()
    expect(crypto.randomUUID()).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('validates that expo-crypto.randomUUID is available', () => {
    const crypto = new ReactNativeCrypto()
    expect(() => crypto.validateCrypto()).not.toThrow()
  })
})
