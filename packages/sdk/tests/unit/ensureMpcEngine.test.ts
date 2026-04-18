import { __resetRuntimeStoreForTesting, configureMpc, ensureMpcEngine, type MpcEngine } from '@vultisig/mpc-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wasmCtor = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/mpc-wasm', () => ({
  WasmMpcEngine: class WasmMpcEngine {
    constructor() {
      wasmCtor()
    }

    initialize = async () => {}

    dkls = {} as MpcEngine['dkls']

    schnorr = {} as MpcEngine['schnorr']
  },
}))

function minimalConfiguredEngine(label: string): MpcEngine {
  return {
    initialize: async () => {},
    dkls: { _label: label } as unknown as MpcEngine['dkls'],
    schnorr: { _label: label } as unknown as MpcEngine['schnorr'],
  }
}

describe('ensureMpcEngine', () => {
  beforeEach(() => {
    wasmCtor.mockClear()
  })

  afterEach(() => {
    __resetRuntimeStoreForTesting()
  })

  it('returns configured engine without constructing WasmMpcEngine', async () => {
    const configured = minimalConfiguredEngine('pre')
    configureMpc(configured)
    const out = await ensureMpcEngine()
    expect(out).toBe(configured)
    expect(wasmCtor).not.toHaveBeenCalled()
  })

  it('dynamic-imports mpc-wasm and registers WasmMpcEngine when unset', async () => {
    const out = await ensureMpcEngine()
    expect(wasmCtor).toHaveBeenCalledTimes(1)
    expect(out.initialize).toBeTypeOf('function')
    expect(out.dkls).toBeDefined()
    expect(out.schnorr).toBeDefined()
  })
})
