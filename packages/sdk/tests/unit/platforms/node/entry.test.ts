import { describe, expect, it } from 'vitest'

describe('node entry exports shared chains namespace', () => {
  it('re-exports the shared chains namespace from the node entrypoint', async () => {
    const node = await import('../../../../src/platforms/node/index')

    expect(node.chains).toBeDefined()
    expect(typeof node.chains.cosmos.buildCosmosStakingTx).toBe('function')
    expect(typeof node.chains.evm.buildEvmSendTx).toBe('function')
  })
})
