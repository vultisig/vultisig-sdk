/**
 * sdk#1867: `estimateSendFee` must be reachable from the PUBLIC vault surface.
 *
 * `swap-types.ts` and VaultBase's own `maxSwapable` comments instruct consumers
 * to call `estimateSendFee()` when a transfer route reports `maxSwapable: 0n`,
 * but the implementation lives on `TransactionBuilder`, which VaultBase holds
 * as a `protected` field. Without a public wrapper the documented instruction
 * is uncallable and consumers approximate max-send or reach into internals.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { VaultBase } from '../../../src/vault/VaultBase'

describe('VaultBase.estimateSendFee (public surface, sdk#1867)', () => {
  it('is exposed on the prototype', () => {
    expect(typeof (VaultBase.prototype as { estimateSendFee?: unknown }).estimateSendFee).toBe('function')
  })

  it('forwards its params to the transaction builder and returns the fee', async () => {
    const estimateSendFee = vi.fn().mockResolvedValue(21_000n)

    // Call the wrapper against a stand-in holding only the collaborator it
    // touches — VaultBase is abstract and full construction needs WalletCore.
    const stub = { transactionBuilder: { estimateSendFee } }
    const wrapper = (VaultBase.prototype as unknown as Record<string, (...a: unknown[]) => Promise<bigint>>)
      .estimateSendFee

    const params = {
      coin: { chain: Chain.Ethereum, address: '0xsender', decimals: 18, ticker: 'ETH' },
      receiver: '0xreceiver',
      amount: 1_000n,
      memo: 'hello',
    }

    const fee = await wrapper.call(stub, params)

    expect(fee).toBe(21_000n)
    expect(estimateSendFee).toHaveBeenCalledTimes(1)
    // Forwarded verbatim — the wrapper must not reshape or drop fields
    // (memo / destinationTag / feeSettings all change the fee).
    expect(estimateSendFee).toHaveBeenCalledWith(params)
  })
})
