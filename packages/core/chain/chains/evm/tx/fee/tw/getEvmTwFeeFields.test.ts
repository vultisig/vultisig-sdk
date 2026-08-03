import { TW } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { EvmChain } from '../../../../../Chain'
import { getEvmTwFeeFields } from './getEvmTwFeeFields'

const input = {
  maxFeePerGasWei: 100n,
  priorityFee: 10n,
  gasLimit: 21_000n,
}

describe('getEvmTwFeeFields', () => {
  // Sei must sign enveloped (EIP-1559) to match iOS/Android, which sign every
  // EVM chain except BSC that way. A legacy tx here changes the pre-signing
  // hash and therefore the relay message_id, deadlocking mobile<->extension
  // co-signing (vultisig-windows#4369). Pins evmChainTxFeeFormat[Sei] against
  // an accidental revert to 'legacy'.
  it('signs Sei as an enveloped (EIP-1559) transaction, not legacy', () => {
    const fields = getEvmTwFeeFields({ chain: EvmChain.Sei, ...input })

    expect(fields.txMode).toBe(TW.Ethereum.Proto.TransactionMode.Enveloped)
    expect(fields).toHaveProperty('maxFeePerGas')
    expect(fields).toHaveProperty('maxInclusionFeePerGas')
    expect(fields).not.toHaveProperty('gasPrice')
  })

  it('signs BSC as a legacy transaction (the sole documented exception)', () => {
    const fields = getEvmTwFeeFields({ chain: EvmChain.BSC, ...input })

    expect(fields.txMode).toBe(TW.Ethereum.Proto.TransactionMode.Legacy)
    expect(fields).toHaveProperty('gasPrice')
    expect(fields).not.toHaveProperty('maxFeePerGas')
  })
})
