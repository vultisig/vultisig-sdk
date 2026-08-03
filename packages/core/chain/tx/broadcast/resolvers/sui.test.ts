import { afterEach, describe, expect, it, vi } from 'vitest'

import { OtherChain } from '../../../Chain'
import { isTransientBroadcastError, withTransientBroadcastRetry } from '../transientRetry'

const { mockExecute, mockVerify } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockVerify: vi.fn(async () => {}),
}))
vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ executeTransaction: mockExecute }),
}))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mockVerify }))

import { broadcastSuiTx } from './sui'

// `unsignedTx` is base64 (TW.Sui.Proto.SigningOutput). The resolver decodes it to BCS bytes for the
// unified client, so the fixture must be VALID base64 ('tx-block').
const tx = { unsignedTx: 'dHgtYmxvY2s=', signature: 'sig' } as never

// A real Sui execution error renders the aborting package's OWN module/function identifiers,
// so the string is chain-controlled and can read exactly like a transient network error.
const moveAbort = 'MoveAbort(MoveLocation { module: 0x2::pool, function_name: Some("aborted") }, 1) in command 0'

const failed = (message: string) => ({
  $kind: 'FailedTransaction' as const,
  FailedTransaction: {
    digest: '0xabc',
    status: { success: false, error: { message } },
    effects: { transactionDigest: '0xabc' },
  },
})

const succeeded = {
  $kind: 'Transaction' as const,
  Transaction: {
    digest: '0xabc',
    status: { success: true, error: null },
    effects: { transactionDigest: '0xabc' },
  },
}

describe('broadcastSuiTx — sdk#1398 MoveAbort false-success', () => {
  afterEach(() => vi.clearAllMocks())

  it('requests effects and throws when the tx aborts on-chain (FailedTransaction arm)', async () => {
    mockExecute.mockResolvedValueOnce(failed('MoveAbort'))
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow(/failed on-chain/i)
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ include: { effects: true } }))
    // A genuinely-failed Move is NOT fed back into verifyBroadcastByHash (it's on-chain, not un-broadcast).
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('throws on a Transaction arm whose execution status says failure', async () => {
    // The union arm and the status must BOTH say success; a mismatched pair is not proven success.
    mockExecute.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { digest: '0xabc', status: { success: false, error: { message: 'InsufficientGas' } } },
    })
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow(/InsufficientGas/)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('fails closed when execution status is missing/unknown (must not default to success)', async () => {
    // With effects requested a real endpoint always returns a status; a response WITHOUT an
    // explicit success is not proven execution success and must NOT be reported as one.
    mockExecute.mockResolvedValueOnce({ $kind: 'Transaction', Transaction: { digest: '0xabc' } })
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('the on-chain-failure throw is NOT classified transient (would otherwise be re-sent)', async () => {
    // The abort text is CHAIN-controlled: a Move location carries the aborting package's own module
    // and function identifiers, so a genuine on-chain failure can render a word that
    // isTransientBroadcastError's message regex matches ("aborted" here; "timed out" and
    // "connection reset" are just as reachable from a Move identifier). DeliverTxFailedError must
    // short-circuit on the `instanceof` BEFORE that regex ever runs. Keep this fixture
    // regex-matching: with a message that matches nothing, the assertion passes on a bare Error too
    // and the guard goes inert.
    mockExecute.mockResolvedValueOnce(failed(moveAbort))
    const err = await broadcastSuiTx({ chain: OtherChain.Sui, tx }).catch((e: unknown) => e)
    expect(isTransientBroadcastError(err)).toBe(false)
    // Red-on-revert anchor: prove the fixture really does trip the message regex, so the assertion
    // above can only be passing because of the marker.
    expect(isTransientBroadcastError(new Error(`Sui transaction failed on-chain: ${moveAbort}`))).toBe(true)
  })

  // neavra CR: sui is NOT in hasResolverOwnedRetry, so it runs INSIDE withTransientBroadcastRetry.
  // Exercise the resolver THROUGH the wrapper (the isolation blind spot that missed #1316 H1): an
  // on-chain MoveAbort must throw ONCE, not be re-broadcast 3x, and must not route into verify.
  it('does not re-broadcast an on-chain MoveAbort when run through withTransientBroadcastRetry', async () => {
    // Same chain-controlled text as above — a fixture the transient regex does NOT match would let
    // this pass on a bare Error and prove nothing about the wrapper.
    mockExecute.mockResolvedValue(failed(moveAbort))

    await expect(withTransientBroadcastRetry(() => broadcastSuiTx({ chain: OtherChain.Sui, tx }))).rejects.toThrow(
      /failed on-chain/i
    )
    // Called exactly once = the wrapper did NOT retry the aborted tx (marker short-circuited).
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns the response when the tx executes successfully', async () => {
    mockExecute.mockResolvedValueOnce(succeeded)
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).resolves.toBe(succeeded)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('sends decoded BCS bytes and the signature under the unified request shape', async () => {
    mockExecute.mockResolvedValueOnce(succeeded)
    await broadcastSuiTx({ chain: OtherChain.Sui, tx })

    const request = mockExecute.mock.calls[0]?.[0]
    // gRPC/GraphQL take raw bytes + `signatures[]`, NOT a base64 `transactionBlock` + `signature[]`.
    expect(request.transaction).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(request.transaction)).toBe('tx-block')
    expect(request.signatures).toEqual(['sig'])
  })

  it('verifies by hash on an RPC-level error (unchanged behavior)', async () => {
    mockExecute.mockRejectedValueOnce(new Error('network'))
    await broadcastSuiTx({ chain: OtherChain.Sui, tx })
    expect(mockVerify).toHaveBeenCalledOnce()
  })
})
