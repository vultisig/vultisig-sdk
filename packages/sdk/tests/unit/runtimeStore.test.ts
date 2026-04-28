import { __resetRuntimeStoreForTesting, type MpcEngine, runtimeStore } from '@vultisig/mpc-types'
import { afterEach, describe, expect, it } from 'vitest'

const repoRuntimeHref = new URL('../../../mpc-types/src/runtime.ts', import.meta.url).href

function minimalEngine(id: string): MpcEngine {
  return {
    initialize: async () => {},
    dkls: { _id: id } as unknown as MpcEngine['dkls'],
    schnorr: { _id: id } as unknown as MpcEngine['schnorr'],
  }
}

describe('runtimeStore', () => {
  afterEach(() => {
    __resetRuntimeStoreForTesting()
  })

  it('returns the same object on repeat calls', () => {
    expect(runtimeStore()).toBe(runtimeStore())
  })

  it('uses Symbol.for key vultisig.runtime.store.v1', () => {
    const key = Symbol.for('vultisig.runtime.store.v1')
    expect(Symbol.keyFor(key)).toBe('vultisig.runtime.store.v1')
  })

  it('shares mpc engine across duplicate module instances (simulated bundler copies)', async () => {
    const modA = await import(`${repoRuntimeHref}?runtimeDup=a`)
    const modB = await import(`${repoRuntimeHref}?runtimeDup=b`)

    const engine = minimalEngine('dup-test')
    modA.configureMpc(engine)
    expect(modB.getMpcEngine()).toBe(engine)
  })
})
