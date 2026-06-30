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

  // Decodes the relayed bytes through the same path the SDK signing resolver
  // uses, and returns the message account keys (base58) so each op can assert
  // which accounts it touches — a wrong-but-stable proto mapping would
  // otherwise still decode into "some" transaction and pass.
  const accountKeysOf = (base64: string): string[] => {
    const coinType = walletCore.CoinType.solana
    const decoded = walletCore.TransactionDecoder.decode(coinType, Buffer.from(base64, 'base64'))
    const { transaction } = TW.Solana.Proto.DecodingTransactionOutput.decode(decoded)
    expect(transaction).toBeTruthy()
    return transaction?.v0?.accountKeys ?? transaction?.legacy?.accountKeys ?? []
  }

  // Stake program — present in every native-staking instruction.
  const stakeProgramId = 'Stake11111111111111111111111111111111111111'

  it('delegate references the validator vote account and derives a fresh stake account', () => {
    const keys = accountKeysOf(build({ op: 'delegate', votePubkey: voteAccount, lamports: 2_000_000_000n }))
    expect(keys).toContain(sender)
    expect(keys).toContain(stakeProgramId)
    expect(keys).toContain(voteAccount)
    // delegate omits the stake account so wallet-core derives a NEW one — our
    // arbitrary fixed `stakeAccount` must not appear.
    expect(keys).not.toContain(stakeAccount)
  })

  it('deactivate (unstake) references the existing stake account, not a validator', () => {
    const keys = accountKeysOf(build({ op: 'unstake', stakeAccount }))
    expect(keys).toContain(stakeProgramId)
    expect(keys).toContain(stakeAccount)
    // Deactivate carries no validator.
    expect(keys).not.toContain(voteAccount)
  })

  it('withdraw references the existing stake account and the recipient (sender)', () => {
    const keys = accountKeysOf(build({ op: 'withdraw', stakeAccount, lamports: 1_000_000_000n }))
    expect(keys).toContain(stakeProgramId)
    expect(keys).toContain(stakeAccount)
    expect(keys).toContain(sender)
    expect(keys).not.toContain(voteAccount)
  })

  it('move-stake redelegate re-delegates the EXISTING stake account to the validator', () => {
    const keys = accountKeysOf(
      build({ op: 'moveStakeRedelegate', stakeAccount, votePubkey: voteAccount, lamports: 1_000_000_000n })
    )
    expect(keys).toContain(stakeProgramId)
    // Unlike a fresh delegate, the existing account is set explicitly...
    expect(keys).toContain(stakeAccount)
    // ...and re-delegated to the validator.
    expect(keys).toContain(voteAccount)
  })

  it('is byte-stable for a fixed payload + blockhash (the MPC relay parity contract)', () => {
    const payload = {
      op: 'delegate' as const,
      votePubkey: voteAccount,
      lamports: 2_000_000_000n,
    }
    // Pinned known-good encoding — peers sign these exact relayed bytes, so a
    // change here is an intentional encoding change to review, not noise.
    const expected =
      'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAICupKbGPinFIKvvVQexMuxfmVR3auvr57kkIe6mkURtIsz4QGrXslwGLXSdJJmKlRZKeSHfnc3Q3XZZuy7iCrGwoGp9UXGSxcUSGMyUw9SvF/WNruCJuh/UTj29mKAAAAAF68hTcsFSGbzOqwW8Xn4U30dQEzTIvP1NCDkX6BLoqLBqfVFxjHdMkoVmOYaR1etoteuKObS21cc1VbIQAAAAAGp9UXGTWE0P7tm7NDHRMga+VEKBtXuFZsxTdf9AAAAAah2BelAgULaAeR5s5tuI4eW3FQ9h/GeQpOtNEAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAah2BeRN1QqmDQ3vf4qerJVf1NcinhyK2ikncAAAAAA6KfLEEmpo7Wh9r/unHsIxcpySPvcuWIboAQrWi0zIHYFBwAJA6CGAQAAAAAABwAFAkANAwAIAwABAHwDAAAA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iwgAAAAAAAAAEdmQnoxek1iZThWZDhnWlo4bkUxa0NUOUxEWmtxRFgxAJQ1dwAAAADIAAAAAAAAAAah2BeRN1QqmDQ3vf4qerJVf1NcinhyK2ikncAAAAAACQIBAnQAAAAA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0izqSmxj4pxSCr71UHsTLsX5lUd2rr6+e5JCHuppFEbSLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkGAQMEBQYABAIAAAAA'
    const actual = build(payload)
    expect(actual).toBe(expected)
    // And rebuilding is deterministic (no timestamps / randomness).
    expect(build(payload)).toBe(actual)
  })
})
