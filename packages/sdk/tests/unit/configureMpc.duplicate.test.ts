import { __resetRuntimeStoreForTesting, configureMpc, getMpcEngine, type MpcEngine } from '@vultisig/mpc-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function minimalEngine(id: string): MpcEngine {
  return {
    initialize: async () => {},
    dkls: { _id: id } as unknown as MpcEngine['dkls'],
    schnorr: { _id: id } as unknown as MpcEngine['schnorr'],
  }
}

describe('configureMpc duplicate engine detection', () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...envSnapshot }
  })

  afterEach(() => {
    process.env = { ...envSnapshot }
    __resetRuntimeStoreForTesting()
  })

  it('is a no-op when called twice with the same engine reference', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const engine = minimalEngine('same')
    configureMpc(engine)
    configureMpc(engine)
    expect(getMpcEngine()).toBe(engine)
    expect(err).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('throws in non-production when a second distinct engine is registered', () => {
    process.env.NODE_ENV = 'test'
    Reflect.deleteProperty(process.env, 'VULTISIG_STRICT_SINGLETON')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).toThrow(/configureMpc: duplicate MPC engine instance/)
    expect(getMpcEngine()).toBe(a)
  })

  it('throws when NODE_ENV is unset (default-strict browser / plain-ESM path)', () => {
    Reflect.deleteProperty(process.env, 'NODE_ENV')
    Reflect.deleteProperty(process.env, 'VULTISIG_STRICT_SINGLETON')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).toThrow(/configureMpc: duplicate MPC engine instance/)
    expect(getMpcEngine()).toBe(a)
  })

  it('does not throw in production when a second distinct engine is registered', () => {
    process.env.NODE_ENV = 'production'
    Reflect.deleteProperty(process.env, 'VULTISIG_STRICT_SINGLETON')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).not.toThrow()
    expect(getMpcEngine()).toBe(b)
    expect(err).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('respects VULTISIG_STRICT_SINGLETON=0 to skip the throw in non-production', () => {
    process.env.NODE_ENV = 'test'
    process.env.VULTISIG_STRICT_SINGLETON = '0'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).not.toThrow()
    expect(getMpcEngine()).toBe(b)
  })

  it('forces a throw when VULTISIG_STRICT_SINGLETON=1 even in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.VULTISIG_STRICT_SINGLETON = '1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).toThrow(/configureMpc: duplicate MPC engine instance/)
    expect(getMpcEngine()).toBe(a)
  })
})
