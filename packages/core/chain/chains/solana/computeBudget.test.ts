import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import jupiterSwapFixtures from '../../fixtures/jupiter-swap-transactions.json'
import lifiSwapFixtures from '../../fixtures/lifi-solana-swap-transactions.json'
import { getSolanaMessageFee } from './computeBudget'

const payer = Keypair.generate().publicKey
const cosigner = Keypair.generate().publicKey
const recentBlockhash = '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB'

const transfer = (from: PublicKey = payer) =>
  SystemProgram.transfer({ fromPubkey: from, toPubkey: cosigner, lamports: 1 })

const v0Message = (instructions: TransactionInstruction[]) =>
  new TransactionMessage({ payerKey: payer, recentBlockhash, instructions }).compileToV0Message()

const decode = (base64: string) => VersionedTransaction.deserialize(Buffer.from(base64, 'base64')).message

describe('getSolanaMessageFee', () => {
  it('charges the base fee alone when no unit price is set', () => {
    expect(getSolanaMessageFee(v0Message([transfer()]))).toBe(5_000n)
  })

  it('charges the price against the set limit, rounded up to a whole lamport', () => {
    const message = v0Message([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_234_567 }),
      transfer(),
    ])

    // 300,000 × 1,234,567 / 1e6 = 370,370.1, rounded up to 370,371
    expect(getSolanaMessageFee(message)).toBe(375_371n)
  })

  it('charges a price without a limit against 200,000 units per other instruction', () => {
    const message = v0Message([
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      transfer(),
      transfer(),
    ])

    expect(getSolanaMessageFee(message)).toBe(405_000n)
  })

  it('caps the limit at 1.4M units', () => {
    const message = v0Message([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      transfer(),
    ])

    expect(getSolanaMessageFee(message)).toBe(1_405_000n)
  })

  it('charges the base fee once per required signature', () => {
    expect(getSolanaMessageFee(v0Message([transfer(cosigner)]))).toBe(10_000n)
  })

  it('reads a legacy message the same way', () => {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10 }), transfer()],
    }).compileToLegacyMessage()

    expect(getSolanaMessageFee(message)).toBe(5_002n)
  })

  // Each expected value is what mainnet `getFeeForMessage` returned for the
  // fixture's message on 2026-10-26, with the blockhash refreshed (the fee
  // does not depend on it).
  it.each([
    ['Jupiter single-hop SOL -> USDC', jupiterSwapFixtures.singleHopSolToUsdc.swapTransaction, 105_000n],
    ['Jupiter multi-hop SOL -> BONK', jupiterSwapFixtures.multiHopSolToBonk.swapTransaction, 75_812n],
    ['LI.FI SOL -> USDC', lifiSwapFixtures.solToUsdc.swapTransaction, 48_423n],
  ])('matches the runtime fee for a recorded %s transaction', (_, swapTransaction, fee) => {
    expect(getSolanaMessageFee(decode(swapTransaction))).toBe(fee)
  })
})
