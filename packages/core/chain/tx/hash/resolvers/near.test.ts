import { Chain } from '@vultisig/core-chain/Chain'
import { buildNearSignedTransfer, SENDER } from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { getNearSignerId, getNearTransactionHash } from '@vultisig/core-chain/chains/near/signedTransaction'
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'

import { getTxHash } from '../index'

describe('NEAR local transaction hash', () => {
  const { body, signedTransaction, expectedHash, signingOutput } = buildNearSignedTransfer()

  it('hashes the unsigned body, which is the digest that was signed, never the signed bytes', () => {
    expect(getTxHash({ chain: Chain.Near, tx: signingOutput })).toBe(expectedHash)
    expect(bs58.encode(createHash('sha256').update(signedTransaction).digest())).not.toBe(expectedHash)
    expect(getNearSignerId(signedTransaction)).toBe(SENDER)
  })

  it.each([
    ['too short to carry a signature', Buffer.alloc(10)],
    ['not Ed25519', Buffer.concat([body, Buffer.from([0x01]), Buffer.alloc(64)])],
  ])('refuses to derive a hash from a %s', async (_label, malformed) => {
    expect(() => getNearTransactionHash(malformed)).toThrow(/signature/)
  })
})
