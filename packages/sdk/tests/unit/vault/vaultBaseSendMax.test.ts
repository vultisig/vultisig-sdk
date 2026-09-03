import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { VaultBase } from '@/vault/VaultBase'

const tonCoin = { chain: Chain.Ton, address: 'UQfrom', decimals: 9, ticker: 'TON' }

const maxSendable = 9_950_000_000n

/**
 * `send` is exercised against a stub receiver rather than a constructed vault: the
 * only thing under test is which flags it hands `prepareSendTx`, and a real vault
 * would drag in wasm, balances and signing to observe one argument.
 */
const callSend = async (amount: string) => {
  const prepareSendTx = vi.fn().mockResolvedValue({ __mock: 'payload' })
  const stub = {
    resolveTokenInfo: () => ({ decimals: 9, ticker: 'TON', contractAddress: undefined }),
    buildAccountCoin: () => tonCoin,
    address: async () => tonCoin.address,
    getMaxSendAmount: async () => ({ maxSendable }),
    parseAmount: (value: string) => BigInt(value),
    formatUnits: (value: bigint) => value.toString(),
    transactionBuilder: { estimateSendFee: async () => 10_000_000n },
    prepareSendTx,
  }

  const result = await VaultBase.prototype.send.call(stub as never, {
    chain: Chain.Ton,
    to: 'UQto',
    amount,
    dryRun: true,
  })

  return { prepareSendTx, result }
}

describe('VaultBase.send — MAX intent', () => {
  it('records MAX when the caller asked for it', async () => {
    const { prepareSendTx } = await callSend('max')

    expect(prepareSendTx).toHaveBeenCalledWith(expect.objectContaining({ amount: maxSendable, sendMaxAmount: true }))
  })

  it('does not record MAX for an explicit amount, even one equal to the max', async () => {
    const { prepareSendTx } = await callSend(maxSendable.toString())

    expect(prepareSendTx).toHaveBeenCalledWith(expect.objectContaining({ sendMaxAmount: false }))
  })
})
