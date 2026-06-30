import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { Buffer } from 'buffer'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildUnsignedStakingTx } from './buildUnsignedStakingTx'

// A real mainnet validator vote account + an arbitrary stake account address.
const voteAccount = '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStpAVL21vNXc'
const stakeAccount = 'C9uS6ouW9bx3JZ5pZ1Tt5pAhnRfTrwH4q1f2qfQ8XmA'
const recentBlockHash = 'GfBz1zMbe8Vd8gZZ8nE1kCT9LDZkqDX1tu9q3iJ8q9aD'

describe('buildUnsignedStakingTx', () => {
  let walletCore: WalletCore
  // A consistent (sender, pubkey) pair derived from a fixed ed25519 key — the
  // compiler matches the placeholder signature to the fee-payer's pubkey, so
  // the two must correspond.
  let sender: string
  let hexPublicKey: string

  beforeAll(async () => {
    walletCore = await initWasm()
    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(7))
    const publicKey = privateKey.getPublicKeyEd25519()
    hexPublicKey = walletCore.HexCoding.encode(publicKey.data()).replace(/^0x/, '')
    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.solana).description()
  })

  const build = (payload: Parameters<typeof buildUnsignedStakingTx>[0]['payload']) =>
    buildUnsignedStakingTx({
      walletCore,
      payload,
      sender,
      hexPublicKey,
      recentBlockHash,
      priorityFeePrice: 100_000n,
      priorityFeeLimit: 200_000,
    })

  const decode = (base64: string) => {
    const coinType = walletCore.CoinType.solana
    const decoded = walletCore.TransactionDecoder.decode(coinType, Buffer.from(base64, 'base64'))
    return TW.Solana.Proto.DecodingTransactionOutput.decode(decoded)
  }

  it('builds a delegate (create+initialize+delegate) tx that decodes back', () => {
    const base64 = build({
      op: 'delegate',
      votePubkey: voteAccount,
      lamports: 2_000_000_000n,
    })
    expect(base64.length).toBeGreaterThan(0)
    // Round-trips through the same decoder the SDK relay path uses.
    const { transaction } = decode(base64)
    expect(transaction).toBeTruthy()
  })

  it('builds a deactivate (unstake) tx that decodes back', () => {
    const base64 = build({ op: 'unstake', stakeAccount })
    const { transaction } = decode(base64)
    expect(transaction).toBeTruthy()
  })

  it('builds a withdraw tx that decodes back', () => {
    const base64 = build({
      op: 'withdraw',
      stakeAccount,
      lamports: 1_000_000_000n,
    })
    const { transaction } = decode(base64)
    expect(transaction).toBeTruthy()
  })

  it('builds a move-stake redelegate tx (explicit stake account) that decodes back', () => {
    const base64 = build({
      op: 'moveStakeRedelegate',
      stakeAccount,
      votePubkey: voteAccount,
      lamports: 1_000_000_000n,
    })
    const { transaction } = decode(base64)
    expect(transaction).toBeTruthy()
  })

  it('is deterministic for a fixed blockhash + payload (byte parity across devices)', () => {
    const payload = {
      op: 'delegate' as const,
      votePubkey: voteAccount,
      lamports: 2_000_000_000n,
    }
    expect(build(payload)).toEqual(build(payload))
  })
})
