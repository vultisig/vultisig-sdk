import { TW, WalletCore } from '@trustwallet/wallet-core'
import { Buffer } from 'buffer'
import Long from 'long'

import { SolanaStakingPayload } from './stakingPayload'

type BuildUnsignedStakingTxInput = {
  walletCore: WalletCore
  payload: SolanaStakingPayload
  /** The signer's Solana address (fee payer / stake authority). */
  sender: string
  /** The signer's ed25519 public key, hex-encoded. */
  hexPublicKey: string
  recentBlockHash: string
  priorityFeePrice: bigint
  priorityFeeLimit: number
}

const toLong = (value: bigint): Long => Long.fromString(value.toString())

/**
 * Maps a staking payload to the wallet-core `SigningInput` transaction-type
 * oneof:
 *   - delegate:            `delegateStakeTransaction` (stake account omitted →
 *                          wallet-core derives it; emits create+initialize+
 *                          delegate in one tx)
 *   - unstake / move-deactivate: `deactivateStakeTransaction` (existing account)
 *   - withdraw:            `withdrawTransaction` (existing account + amount)
 *   - move-redelegate:     `delegateStakeTransaction` with the existing account
 *                          set EXPLICITLY (re-delegate, don't derive a new one)
 */
const transactionTypeFields = (payload: SolanaStakingPayload): Partial<TW.Solana.Proto.ISigningInput> => {
  switch (payload.op) {
    case 'delegate':
      return {
        delegateStakeTransaction: TW.Solana.Proto.DelegateStake.create({
          validatorPubkey: payload.votePubkey,
          value: toLong(payload.lamports),
        }),
      }
    case 'unstake':
    case 'moveStakeDeactivate':
      return {
        deactivateStakeTransaction: TW.Solana.Proto.DeactivateStake.create({
          stakeAccount: payload.stakeAccount,
        }),
      }
    case 'withdraw':
      return {
        withdrawTransaction: TW.Solana.Proto.WithdrawStake.create({
          stakeAccount: payload.stakeAccount,
          value: toLong(payload.lamports),
        }),
      }
    case 'moveStakeRedelegate':
      return {
        delegateStakeTransaction: TW.Solana.Proto.DelegateStake.create({
          validatorPubkey: payload.votePubkey,
          value: toLong(payload.lamports),
          stakeAccount: payload.stakeAccount,
        }),
      }
  }
}

/**
 * Compiles the unsigned staking transaction (zero-signature envelope) and
 * returns it base64-encoded. This is the byte-parity contract for native
 * staking: the initiating device builds these bytes once — pinning the recent
 * blockhash and the wallet-core-derived stake-account address — and relays them
 * via `SignSolana.rawTransactions`. Every co-signing device then signs the
 * IDENTICAL message bytes through the raw-transaction path, so no device
 * rebuilds the input from a non-round-tripped staking payload.
 *
 * Port of iOS `SolanaHelper.buildStakingUnsignedTransaction`.
 */
export const buildUnsignedStakingTx = ({
  walletCore,
  payload,
  sender,
  hexPublicKey,
  recentBlockHash,
  priorityFeePrice,
  priorityFeeLimit,
}: BuildUnsignedStakingTxInput): string => {
  const input = TW.Solana.Proto.SigningInput.create({
    v0Msg: true,
    recentBlockhash: recentBlockHash,
    sender,
    priorityFeePrice: TW.Solana.Proto.PriorityFeePrice.create({
      price: toLong(priorityFeePrice),
    }),
    priorityFeeLimit: TW.Solana.Proto.PriorityFeeLimit.create({
      limit: priorityFeeLimit,
    }),
    ...transactionTypeFields(payload),
  })
  const inputData = TW.Solana.Proto.SigningInput.encode(input).finish()

  // Compile a zero-signature envelope: a single 64-byte zero signature plus the
  // signer's public key, exactly as iOS does. The compiler assembles the wire
  // message with the placeholder signature; peers re-sign the relayed bytes.
  const signatures = walletCore.DataVector.create()
  signatures.add(new Uint8Array(64))
  const publicKeys = walletCore.DataVector.create()
  publicKeys.add(Buffer.from(hexPublicKey, 'hex'))

  const compiled = walletCore.TransactionCompiler.compileWithSignatures(
    walletCore.CoinType.solana,
    inputData,
    signatures,
    publicKeys
  )
  const output = TW.Solana.Proto.SigningOutput.decode(compiled)
  if (output.errorMessage) {
    throw new Error(`solana staking compile failed: ${output.errorMessage}`)
  }

  // WalletCore emits base58 (the signing input never sets `txEncoding`).
  // Normalize to base64 — the encoding `SignSolana.rawTransactions` and the
  // raw-signing path consume.
  const txBytes = walletCore.Base58.decodeNoCheck(output.encoded)
  return Buffer.from(txBytes).toString('base64')
}
