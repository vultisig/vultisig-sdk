import { getAssociatedTokenAddressSync } from '@solana/spl-token'
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

  it('returns the original tx data unchanged when the ATA already exists', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValue({ data: Buffer.alloc(0) }), // non-null = exists
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result).toBe(originalData)
    expect(mockClient.getAccountInfo).toHaveBeenCalledOnce()
  })

  it('prepends createAssociatedTokenAccountIdempotentInstruction when ATA is missing', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValue(null), // null = ATA does not exist
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    // Result must differ from original (instruction was injected).
    expect(result).not.toBe(originalData)

    // Deserialize result and verify ATA instruction is the first one.
    const patchedTx = VersionedTransaction.deserialize(Buffer.from(result, 'base64'))
    const patchedMsg = TransactionMessage.decompile(patchedTx.message)

    // Original had 1 instruction; patched must have 2.
    expect(patchedMsg.instructions.length).toBe(2)

    // First instruction must reference the ATA address and USDC mint.
    const ataAddress = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(owner))
    const firstIx = patchedMsg.instructions[0]
    const accountKeys = firstIx.keys.map(k => k.pubkey.toBase58())
    expect(accountKeys).toContain(ataAddress.toBase58())
    expect(accountKeys).toContain(USDC_MINT)
  })

  it('checks the correct ATA address derived from mint + owner', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    const expectedAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(owner))
    expect(mockClient.getAccountInfo).toHaveBeenCalledWith(expectedAta)
  })

  it('re-encodes the transaction as valid base64', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    // Must be valid base64 and deserializable.
    expect(() => {
      VersionedTransaction.deserialize(Buffer.from(result, 'base64'))
    }).not.toThrow()
  })
})
