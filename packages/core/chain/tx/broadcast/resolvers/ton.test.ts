import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { OtherChain } from '@vultisig/core-chain/Chain'
import { TonBroadcastRejectedError } from '@vultisig/core-chain/chains/ton/failure'

import { BroadcastErrorCode } from '../resolver'
import { broadcastTonTx } from './ton'

const chain = OtherChain.Ton
const tx = { encoded: 'te6ccgEBAQEAAgAAAA==' } as any

const walletRefusal = (exitCode: number) =>
  new Error(
    `toncenter sendBocReturnHash failed: LITE_SERVER_UNKNOWN: cannot apply external message to current state : External message was not accepted\nCannot run message on account: inbound external message rejected by transaction 4C6FE61A4B7925532DEE47DEED8367FB9E918D4B32A9B9EC270BEF9D9C65CA13:\nexitcode=${exitCode}, steps=49, gas_used=0\n`
  )

describe('broadcastTonTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a broadcast the proxy answered with a hash', async () => {
    mocks.queryUrl.mockResolvedValue({ result: { hash: 'msg-hash' } })

    await expect(broadcastTonTx({ chain, tx })).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: 'msg-hash',
    })
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('treats a seqno refusal as success when the same message is already on chain (a co-signer broadcast first)', async () => {
    mocks.queryUrl.mockRejectedValue(walletRefusal(133))
    mocks.verifyBroadcastByHash.mockResolvedValue('msg-hash')

    await expect(broadcastTonTx({ chain, tx })).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: 'msg-hash',
    })
  })

  it('explains a wallet-contract refusal and does not retry it', async () => {
    const refusal = walletRefusal(136)
    mocks.queryUrl.mockRejectedValue(refusal)
    mocks.verifyBroadcastByHash.mockRejectedValue(refusal)

    const result = await broadcastTonTx({ chain, tx })

    expect(result).toMatchObject({ status: 'failed', code: BroadcastErrorCode.Rejected, retryable: false })
    if (result.status !== 'failed') throw new Error('expected a failed broadcast')

    const { cause } = result
    expect(cause).toBeInstanceOf(TonBroadcastRejectedError)
    if (!(cause instanceof TonBroadcastRejectedError)) throw new Error('expected a TonBroadcastRejectedError')

    expect(cause.failure).toMatchObject({ reason: 'expired', phase: 'compute', exitCode: 136 })
    expect(cause.message).toMatch(/date and time/)
    expect(cause.cause).toBe(refusal)
  })

  it('passes other failures through unexplained', async () => {
    const outage = new Error('Failed to unpack Message')
    mocks.queryUrl.mockRejectedValue(outage)
    mocks.verifyBroadcastByHash.mockRejectedValue(outage)

    const result = await broadcastTonTx({ chain, tx })

    expect(result).toMatchObject({ status: 'failed', cause: outage })
  })
})
