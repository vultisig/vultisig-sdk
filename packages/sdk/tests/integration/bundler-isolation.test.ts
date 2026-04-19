import { __resetRuntimeStoreForTesting, type MpcEngine } from '@vultisig/mpc-types'
import { afterEach, describe, expect, it } from 'vitest'

const repoRuntimeHref = new URL('../../../mpc-types/src/runtime.ts', import.meta.url).href

function minimalEngine(id: string): MpcEngine {
  return {
    initialize: async () => {},
    dkls: { _id: id } as unknown as MpcEngine['dkls'],
    schnorr: { _id: id } as unknown as MpcEngine['schnorr'],
  }
}

describe('bundler isolation (#287)', () => {
  afterEach(() => {
    __resetRuntimeStoreForTesting()
  })

  it('shares the MPC engine across two isolated runtime module instances', async () => {
    const modA = await import(`${repoRuntimeHref}?bundlerIsolation=a`)
    const modB = await import(`${repoRuntimeHref}?bundlerIsolation=b`)

    const engine = minimalEngine('integration-dup')
    modA.configureMpc(engine)
    expect(modB.getMpcEngine()).toBe(engine)
  })
})
