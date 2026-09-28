import { beforeEach, describe, expect, it, vi } from 'vitest'

const createType = vi.fn()

vi.mock('@vultisig/core-chain/chains/polkadot/client', () => ({
  getPolkadotClient: async () => ({ createType }),
}))

import { getPolkadotTxHash } from './polkadot'

describe('getPolkadotTxHash', () => {
  beforeEach(() => createType.mockReset())

  it('hashes the signed v4 extrinsic via the polkadot client', async () => {
    const encoded = Uint8Array.from([0x45, 0x00])
    createType.mockReturnValueOnce({ hash: { toHex: () => '0xabc123' } })

    await expect(getPolkadotTxHash({ encoded } as never)).resolves.toBe('0xabc123')
    expect(createType).toHaveBeenCalledWith('Extrinsic', encoded, { isSigned: true, version: 4 })
  })
})
