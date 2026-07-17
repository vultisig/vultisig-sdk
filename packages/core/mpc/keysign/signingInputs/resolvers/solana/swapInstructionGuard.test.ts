import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { SolanaSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getSolanaSigningInputs } from './index'

// sdk#1358 fund-safety: assertSafeSolanaSwapTransactionBase64 re-asserts the Jupiter
// program/fund-movement allow-list on the CO-SIGNER signing-input path (not just at quote
// construction), since every co-signer (e.g. VultiServer in a 2-of-2) independently rebuilds
// this SigningInput from the shared KeysignPayload and signs the raw swap message verbatim.
// This test proves the guard is actually wired into getSolanaSigningInputs's general-swap arm:
// a swapPayload.quote.tx.data carrying a spliced top-level drain instruction must be rejected
// here, and a benign compute-budget-only swap tx must still sign cleanly (no over-blocking).
const SENDER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'
const ATTACKER = 'Eviievi1evi1evi1evi1evi1evi1evi1evi1evi1evi'
const BLOCKHASH = '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB'

const legacyTxToBase64 = (tx: Transaction) => {
  const message = tx.compileMessage()
  const versionedTx = new VersionedTransaction(message)
  return Buffer.from(versionedTx.serialize()).toString('base64')
}

const buildDrainSwapTxBase64 = () => {
  const sender = new PublicKey(SENDER)
  const attacker = new PublicKey(ATTACKER)
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: attacker, lamports: 1000 }))
  tx.recentBlockhash = BLOCKHASH
  tx.feePayer = sender
  return legacyTxToBase64(tx)
}

const buildBenignSwapTxBase64 = () => {
  const sender = new PublicKey(SENDER)
  const tx = new Transaction()
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }))
  tx.recentBlockhash = BLOCKHASH
  tx.feePayer = sender
  return legacyTxToBase64(tx)
}

const buildPayload = (swapTxDataBase64: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Solana,
      ticker: 'SOL',
      address: SENDER,
      decimals: 9,
      isNativeToken: true,
    }),
    blockchainSpecific: {
      case: 'solanaSpecific',
      value: create(SolanaSpecificSchema, {
        recentBlockHash: BLOCKHASH,
        priorityFee: '1000000',
        computeLimit: '100000',
      }),
    },
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider: 'jupiter',
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, {
            to: '',
            data: swapTxDataBase64,
            value: '0',
            gasPrice: '0',
            gas: 0n,
          }),
        }),
      }),
    },
  })

describe('getSolanaSigningInputs — sdk#1358 Jupiter swap fund-movement guard on the signing-input path', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('rejects a swapPayload.quote.tx.data carrying a spliced top-level SystemProgram.Transfer draining lamports to an attacker', async () => {
    // Wrapped in Promise.resolve() because SigningInputsResolver's declared return type is
    // `SigningInput[] | Promise<SigningInput[]>` — the unfixed resolver's general arm is
    // synchronous, so `expect().rejects` needs a real promise to assert against either shape.
    await expect(
      Promise.resolve(
        getSolanaSigningInputs({
          keysignPayload: buildPayload(buildDrainSwapTxBase64()),
          walletCore,
        })
      )
    ).rejects.toThrow(/SOL_SWAP_UNSAFE_FUND_MOVEMENT/i)
  })

  it('does not over-block a benign swap tx containing only an allow-listed ComputeBudget instruction', async () => {
    await expect(
      Promise.resolve(
        getSolanaSigningInputs({
          keysignPayload: buildPayload(buildBenignSwapTxBase64()),
          walletCore,
        })
      )
    ).resolves.toBeDefined()
  })
})
