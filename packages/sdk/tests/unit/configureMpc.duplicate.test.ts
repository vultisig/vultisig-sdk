import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MpcEngine } from '../../../mpc-types/src/index'
import { configureMpc, getMpcEngine, WASM_MPC_ENGINE_KIND } from '../../../mpc-types/src/runtime'
import { __resetRuntimeStoreForTesting } from '../../../mpc-types/src/store'
// Import configureMpc from mpc-types source so Vitest does not load two copies of runtime.ts.

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
    __resetRuntimeStoreForTesting()
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

  it('ignores a second distinct engine when both carry the WasmMPC brand', () => {
    process.env.NODE_ENV = 'test'
    Reflect.deleteProperty(process.env, 'VULTISIG_STRICT_SINGLETON')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const branded = (id: string) => ({
      _mpcEngineKind: WASM_MPC_ENGINE_KIND,
      initialize: async () => {},
      dkls: { _id: id } as unknown as MpcEngine['dkls'],
      schnorr: { _id: id } as unknown as MpcEngine['schnorr'],
    })

    const a = branded('a')
    const b = branded('b')
    configureMpc(a as MpcEngine)
    configureMpc(b as MpcEngine)
    expect(getMpcEngine()).toBe(a)
    expect(err).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('still throws for two tagged Wasm engines when VULTISIG_STRICT_SINGLETON=1', () => {
    process.env.NODE_ENV = 'production'
    process.env.VULTISIG_STRICT_SINGLETON = '1'
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const branded = (id: string) => ({
      _mpcEngineKind: WASM_MPC_ENGINE_KIND,
      initialize: async () => {},
      dkls: { _id: id } as unknown as MpcEngine['dkls'],
      schnorr: { _id: id } as unknown as MpcEngine['schnorr'],
    })
    const a = branded('a')
    const b = branded('b')
    configureMpc(a as MpcEngine)
    expect(() => configureMpc(b as MpcEngine)).toThrow(/configureMpc: duplicate MPC engine instance/)
    expect(getMpcEngine()).toBe(a)
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

  it('respects EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON=0 fallback for Expo / RN consumers', () => {
    process.env.NODE_ENV = 'test'
    Reflect.deleteProperty(process.env, 'VULTISIG_STRICT_SINGLETON')
    process.env.EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON = '0'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).not.toThrow()
    expect(getMpcEngine()).toBe(b)
  })

  it('lets VULTISIG_STRICT_SINGLETON take precedence over the EXPO_PUBLIC alias', () => {
    process.env.NODE_ENV = 'test'
    process.env.VULTISIG_STRICT_SINGLETON = '1'
    process.env.EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON = '0'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = minimalEngine('a')
    const b = minimalEngine('b')
    configureMpc(a)
    expect(() => configureMpc(b)).toThrow(/configureMpc: duplicate MPC engine instance/)
    expect(getMpcEngine()).toBe(a)
  })
})
