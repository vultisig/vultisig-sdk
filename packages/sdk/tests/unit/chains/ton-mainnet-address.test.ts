import { Address } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { buildTonJettonTransferTx, buildTonSendTx } from '../../../src/chains/ton/tx'

const account = Address.parse('0:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
const testnetAddresses = [true, false].flatMap(bounceable =>
  [true, false].map(urlSafe => account.toString({ bounceable, urlSafe, testOnly: true }))
)
const options = { publicKeyEd25519: 'aa'.repeat(32), amount: 1n, seqno: 1, bounceable: false }

describe('public TON builders refuse testnet-only destinations on mainnet', () => {
  it.each(testnetAddresses)('rejects %s before the flag can be serialized away', to => {
    expect(() => buildTonSendTx({ ...options, to })).toThrow(/testnet-only/)
    expect(() => buildTonJettonTransferTx({ ...options, to, jettonWalletAddress: account.toString() })).toThrow(
      /testnet-only/
    )
    expect(() => buildTonJettonTransferTx({ ...options, to: account.toString(), jettonWalletAddress: to })).toThrow(
      /testnet-only/
    )
  })
})
