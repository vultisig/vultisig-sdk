import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import { buildSplTransfer } from '@/tools/prep/splTransfer'

// Throwaway, well-known mainnet addresses. NEVER funded, NEVER signed here —
// these tests only exercise the pure-crypto unsigned-instruction builder.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const FROM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const TO = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('buildSplTransfer (pure-crypto unsigned SPL transfer)', () => {
  it('builds an unsigned transferChecked with deterministically-derived ATAs', () => {
    const tx = buildSplTransfer({
      mint: USDC_MINT,
      from: FROM,
      to: TO,
      amount: 1_000_000n, // 1 USDC
      decimals: 6,
    })

    expect(tx.chain).toBe('Solana')
    expect(tx.mint).toBe(USDC_MINT)
    expect(tx.amount).toBe('1000000')
    expect(tx.decimals).toBe(6)
    expect(tx.isToken2022).toBe(false)
    expect(tx.programId).toBe(TOKEN_PROGRAM_ID.toBase58())

    // ATAs match the canonical PDA derivation exactly.
    const expectedFromAta = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(FROM),
      false,
      TOKEN_PROGRAM_ID
    ).toBase58()
    const expectedToAta = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(TO),
      false,
      TOKEN_PROGRAM_ID
    ).toBase58()
    expect(tx.fromTokenAccount).toBe(expectedFromAta)
    expect(tx.toTokenAccount).toBe(expectedToAta)

    // The instruction targets the token program and the owner is the sole signer.
    expect(tx.instruction.programId).toBe(TOKEN_PROGRAM_ID.toBase58())
    const signers = tx.instruction.keys.filter(k => k.isSigner)
    expect(signers).toHaveLength(1)
    expect(signers[0].pubkey).toBe(FROM)

    // transferChecked instruction data: discriminator (12) + u64 amount + u8 decimals.
    const data = Buffer.from(tx.instruction.data, 'base64')
    expect(data.length).toBe(10)
    expect(data[0]).toBe(12) // TokenInstruction.TransferChecked
    expect(data.readBigUInt64LE(1)).toBe(1_000_000n)
    expect(data[9]).toBe(6) // decimals
  })

  it('derives Token-2022 ATAs + program id when isToken2022 is set', () => {
    const tx = buildSplTransfer({
      mint: USDC_MINT,
      from: FROM,
      to: TO,
      amount: 5n,
      decimals: 6,
      isToken2022: true,
    })
    expect(tx.isToken2022).toBe(true)
    expect(tx.programId).toBe(TOKEN_2022_PROGRAM_ID.toBase58())
    expect(tx.instruction.programId).toBe(TOKEN_2022_PROGRAM_ID.toBase58())
    // Token-2022 ATA derivation differs from legacy (different program seed).
    const legacy = buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 5n, decimals: 6 })
    expect(tx.fromTokenAccount).not.toBe(legacy.fromTokenAccount)
  })

  it('is deterministic — same inputs produce byte-identical output', () => {
    const a = buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 42n, decimals: 6 })
    const b = buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 42n, decimals: 6 })
    expect(a).toEqual(b)
  })

  describe('fund-safety guards', () => {
    it('rejects to === mint (funds-lost trap)', () => {
      expect(() => buildSplTransfer({ mint: USDC_MINT, from: FROM, to: USDC_MINT, amount: 1n, decimals: 6 })).toThrow(
        /token mint address/
      )
    })

    it('rejects invalid from/to/mint addresses', () => {
      expect(() =>
        buildSplTransfer({ mint: USDC_MINT, from: 'not-base58!!', to: TO, amount: 1n, decimals: 6 })
      ).toThrow(/invalid Solana `from`/)
      expect(() =>
        buildSplTransfer({ mint: USDC_MINT, from: FROM, to: '0xdeadbeef', amount: 1n, decimals: 6 })
      ).toThrow(/invalid Solana `to`/)
      expect(() => buildSplTransfer({ mint: 'bogus', from: FROM, to: TO, amount: 1n, decimals: 6 })).toThrow(
        /invalid Solana `mint`/
      )
    })

    it('rejects non-positive amounts', () => {
      expect(() => buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 0n, decimals: 6 })).toThrow(
        /greater than zero/
      )
      expect(() => buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: -1n, decimals: 6 })).toThrow(
        /greater than zero/
      )
    })

    it('rejects out-of-range decimals', () => {
      expect(() => buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 1n, decimals: 256 })).toThrow(
        /decimals/
      )
      expect(() => buildSplTransfer({ mint: USDC_MINT, from: FROM, to: TO, amount: 1n, decimals: -1 })).toThrow(
        /decimals/
      )
    })
  })
})
