import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { injectSolanaAtaIfMissing } from './injectSolanaAtaIfMissing'

// Mock the Solana client so we control RPC responses.
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: vi.fn(),
}))

const { getSolanaClient } = await import('@vultisig/core-chain/chains/solana/client')

// ---- helpers ----------------------------------------------------------------

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const payer = Keypair.generate().publicKey.toBase58()
const owner = Keypair.generate().publicKey.toBase58()
const blockhash = '11111111111111111111111111111111'

/** Minimal mint account info response — owner is the Token program (legacy). */
const MOCK_MINT_INFO = { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) }

/**
 * Build a minimal base64-encoded V0 VersionedTransaction that represents
 * a swap tx (one no-op SystemProgram.transfer instruction for the test).
 */
function buildMinimalLifiTx(): string {
  const payerKey = new PublicKey(payer)
  // A minimal instruction so the transaction is valid enough to serialize.
  const ix = SystemProgram.transfer({
    fromPubkey: payerKey,
    toPubkey: payerKey,
    lamports: 0,
  })
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  return Buffer.from(tx.serialize()).toString('base64')
}

// ---- tests ------------------------------------------------------------------

describe('injectSolanaAtaIfMissing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the original tx data unchanged and ataInjected=false when the ATA already exists', async () => {
    const mockClient = {
      // First call: mint account info. Second call: ATA exists (non-null).
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce(MOCK_MINT_INFO)
        .mockResolvedValueOnce({ data: Buffer.alloc(0) }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result.data).toBe(originalData)
    expect(result.ataInjected).toBe(false)
    expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(2)
  })

  it('prepends createAssociatedTokenAccountIdempotentInstruction when ATA is missing', async () => {
    const mockClient = {
      // First call: mint account info. Second call: ATA does not exist (null).
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result.ataInjected).toBe(true)
    // Result data must differ from original (instruction was injected).
    expect(result.data).not.toBe(originalData)

    // Deserialize result and verify ATA instruction is the first one.
    const patchedTx = VersionedTransaction.deserialize(Buffer.from(result.data, 'base64'))
    const patchedMsg = TransactionMessage.decompile(patchedTx.message)

    // Original had 1 instruction; patched must have 2.
    expect(patchedMsg.instructions.length).toBe(2)

    // First instruction must reference the ATA address and USDC mint.
    const ataAddress = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(owner),
      true,
      TOKEN_PROGRAM_ID
    )
    const firstIx = patchedMsg.instructions[0]
    const accountKeys = firstIx.keys.map(k => k.pubkey.toBase58())
    expect(accountKeys).toContain(ataAddress.toBase58())
    expect(accountKeys).toContain(USDC_MINT)
  })

  it('checks the correct ATA address derived from mint + owner', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    const expectedAta = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(owner),
      true,
      TOKEN_PROGRAM_ID
    )
    expect(mockClient.getAccountInfo).toHaveBeenCalledWith(expectedAta)
  })

  it('re-encodes the transaction as valid base64', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    // Must be valid base64 and deserializable.
    expect(() => {
      VersionedTransaction.deserialize(Buffer.from(result.data, 'base64'))
    }).not.toThrow()
  })

  it('throws when caller-supplied payer does not match the tx fee-payer', async () => {
    // Build a tx whose fee-payer is `payer`, but pass a DIFFERENT pubkey as
    // the `payer` arg to injectSolanaAtaIfMissing. The contract violation
    // must surface as a clear thrown error, not a downstream simulation
    // failure. (#519 r3 — NeO should-fix.)
    const wrongPayer = Keypair.generate().publicKey.toBase58()
    const mockClient = {
      // mint exists, ATA does not (so we proceed to decompile + payer check)
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(
      injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, wrongPayer)
    ).rejects.toThrow(/Payer mismatch/)
  })

  it('tolerates a throwing getAddressLookupTable and still injects the ATA', async () => {
    // The minimal tx has no LUT references, so the LUT loop does not run.
    // This test verifies that if getAddressLookupTable were to throw on a tx
    // that DOES reference LUTs, fetchLutWithRetry swallows the error rather
    // than propagating it — the function still completes and injects the ATA.
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    // Must still inject the ATA even if LUT fetching failed/didn't run.
    expect(result.ataInjected).toBe(true)
  })
})
