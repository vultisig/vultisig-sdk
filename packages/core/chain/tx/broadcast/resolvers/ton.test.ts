import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
  sendTonGasless: vi.fn(),
  isTonGaslessRequest: vi.fn(() => false),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

vi.mock('@vultisig/core-chain/chains/ton/gasless/api', () => ({
  sendTonGasless: mocks.sendTonGasless,
}))

vi.mock('@vultisig/core-chain/chains/ton/gasless/request', () => ({
  isTonGaslessRequest: mocks.isTonGaslessRequest,
}))

import { OtherChain } from '@vultisig/core-chain/Chain'
import { TonBroadcastRejectedError } from '@vultisig/core-chain/chains/ton/failure'
import { getTonTxStatus } from '@vultisig/core-chain/tx/status/resolvers/ton'

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
    mocks.isTonGaslessRequest.mockReturnValue(false)
  })

  it('never touches the relay for a direct send', async () => {
    mocks.queryUrl.mockResolvedValue({ result: { hash: 'msg-hash' } })

    await broadcastTonTx({ chain, tx })

    expect(mocks.sendTonGasless).not.toHaveBeenCalled()
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

  it('preserves a provider-returned base64 hash when checking status', async () => {
    const hash = '5Ntg/ZmUbx80Fsc+OvEg0Ti+ZlT2JIaozUizscN0GHk='
    mocks.queryUrl.mockResolvedValueOnce({ result: { hash } }).mockResolvedValueOnce({ transactions: [] })

    const result = await broadcastTonTx({ chain, tx })
    if (result.status !== 'accepted' || !result.txHash) throw new Error('expected an accepted broadcast with a hash')

    await getTonTxStatus({ chain, hash: result.txHash })

    const url = new URL(mocks.queryUrl.mock.calls[1][0])
    expect(url.searchParams.get('msg_hash')).toBe(hash)
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

    expect(result).toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
    })
    if (result.status !== 'failed') throw new Error('expected a failed broadcast')

    const { cause } = result
    expect(cause).toBeInstanceOf(TonBroadcastRejectedError)
    if (!(cause instanceof TonBroadcastRejectedError)) throw new Error('expected a TonBroadcastRejectedError')

    expect(cause.failure).toMatchObject({
      reason: 'expired',
      phase: 'compute',
      exitCode: 136,
    })
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

describe('broadcastTonTx — relayed (gasless) request', () => {
  const bodyHash = Buffer.from('ab'.repeat(32), 'hex')
  const gaslessTx = { encoded: 'te6-relayed', hash: bodyHash } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTonGaslessRequest.mockReturnValue(true)
  })

  it('hands the envelope to the relay and reports the trace id the relay broadcast under', async () => {
    mocks.sendTonGasless.mockResolvedValue({
      protocol_name: 'gasless',
      external: 'relay-trace-id',
    })

    await expect(broadcastTonTx({ chain, tx: gaslessTx })).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: 'relay-trace-id',
    })
    expect(mocks.sendTonGasless).toHaveBeenCalledWith({ boc: 'te6-relayed' })
    expect(mocks.queryUrl).not.toHaveBeenCalled()
  })

  it('falls back to the signed body hash when the relay reports no external hash', async () => {
    mocks.sendTonGasless.mockResolvedValue({ protocol_name: 'gasless' })

    await expect(broadcastTonTx({ chain, tx: gaslessTx })).resolves.toMatchObject({ txHash: 'ab'.repeat(32) })
  })

  it('accepts a relay refusal when the request is already on chain (a co-signer relayed it first)', async () => {
    mocks.sendTonGasless.mockRejectedValue(new Error('HTTP 400: seqno mismatch'))
    mocks.verifyBroadcastByHash.mockResolvedValue('ab'.repeat(32))

    await expect(broadcastTonTx({ chain, tx: gaslessTx })).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: 'ab'.repeat(32),
    })
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith(expect.objectContaining({ chain, tx: gaslessTx }))
  })

  it('reports a relay refusal the chain does not explain as a final failure', async () => {
    const refusal = new Error('HTTP 400: not enough jettons to pay the commission')
    mocks.sendTonGasless.mockRejectedValue(refusal)
    mocks.verifyBroadcastByHash.mockRejectedValue(refusal)

    await expect(broadcastTonTx({ chain, tx: gaslessTx })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: refusal,
    })
  })

  it('reports a relay outage as retryable', async () => {
    const outage = new Error('HTTP 503 Service Unavailable')
    mocks.sendTonGasless.mockRejectedValue(outage)
    mocks.verifyBroadcastByHash.mockRejectedValue(outage)

    await expect(broadcastTonTx({ chain, tx: gaslessTx })).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
    })
  })
})
