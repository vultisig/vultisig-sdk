import { describe, expect, it, vi } from 'vitest'

/**
 * The initiating device must drive messages in the same order every joiner signs
 * them in. `keysign/cosigner.ts` sorts its hashes (`.sort()` over lowercase hex),
 * as do the Android app (`SigningHelper.getKeysignMessages` -> `messages.sorted()`)
 * and the extension (`useKeysignMutation` -> `.sort()`).
 *
 * If `extractMessageHashes` ever returns resolver order again, a multi-message
 * keysign (e.g. an ERC-20 approve + swap) deadlocks: the joiner polls
 * `GET /setup-message/{sessionId}` for a hash the initiator never uploaded and
 * fails with `HTTP 404: Not Found`. It only reproduces when resolver order and
 * sorted order disagree, so the fixture below is deliberately built that way —
 * the approve hash sorts *after* the swap hash.
 */

// Deliberately NOT in sorted order: resolver emits approve first, but 'ff…' > '00…'.
const APPROVE_HASH = 'ff'.padEnd(64, '9')
const SWAP_HASH = '00'.padEnd(64, '1')
const RESOLVER_ORDER = [APPROVE_HASH, SWAP_HASH]

vi.mock('@vultisig/core-mpc/keysign/signingInputs', () => ({
  // One encoded input per message (approve, then swap).
  getEncodedSigningInputs: vi.fn(async () => [new Uint8Array([1]), new Uint8Array([2])]),
}))

vi.mock('@vultisig/core-mpc/tx/preSigningHashes', () => ({
  // Hand back the hashes in resolver order, one per input.
  getPreSigningHashes: vi.fn(({ txInputData }: { txInputData: Uint8Array }) => [
    Buffer.from(RESOLVER_ORDER[txInputData[0] - 1], 'hex'),
  ]),
}))

vi.mock('@vultisig/core-mpc/keysign/utils/getKeysignChain', () => ({
  // QBTC short-circuits public-key derivation in `extractMessageHashes`, which
  // keeps this test on the ordering behaviour instead of WalletCore setup.
  getKeysignChain: () => 'QBTC',
}))

const { TransactionBuilder } = await import('../../src/vault/services/TransactionBuilder')

const buildSubject = () =>
  new TransactionBuilder(
    {} as never,
    {
      getWalletCore: async () => ({}) as never,
    } as never
  )

describe('TransactionBuilder.extractMessageHashes ordering', () => {
  it('returns hashes sorted even when the resolver emits them unsorted', async () => {
    const hashes = await buildSubject().extractMessageHashes({} as never)

    expect(hashes).toEqual([SWAP_HASH, APPROVE_HASH])
    // Guard against the fixture silently becoming pre-sorted.
    expect(hashes).not.toEqual(RESOLVER_ORDER)
  })

  it('matches the order a joiner derives (cosigner.ts sorts the same hex form)', async () => {
    const hashes = await buildSubject().extractMessageHashes({} as never)

    // How `keysign/cosigner.ts` builds its list: same lowercase hex, bare `.sort()`.
    const joinerOrder = [...RESOLVER_ORDER].sort()

    expect(hashes).toEqual(joinerOrder)
  })
})
