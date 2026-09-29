import { blake2AsHex } from '@polkadot/util-crypto'
import { describe, expect, it } from 'vitest'

import { getBittensorTxHash } from './bittensor'

describe('getBittensorTxHash', () => {
  it('returns blake2b-256 of the length-prefixed extrinsic bytes', async () => {
    const encoded = Uint8Array.from([0x45, 0x00, 0x01, 0x02, 0x03])
    await expect(getBittensorTxHash({ encoded } as never)).resolves.toBe(blake2AsHex(encoded, 256))
  })
})
